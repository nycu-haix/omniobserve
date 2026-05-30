import json
import os
import re
from typing import Any

from sqlalchemy import delete, distinct, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import IdeaBlock, PosterIdeaBlockTaskItem, Similarity, TaskItem
from ..task_config.registry import get_task_prompt_config
from .similarity_notifications import notify_similarity_cue_for_blocks

COSINE_SIMILARITY_THRESHOLD = 0.7
COSINE_DISTANCE_THRESHOLD = 1 - COSINE_SIMILARITY_THRESHOLD

async def trigger_similarity_detection(idea_block_id: int, db: AsyncSession) -> None:
    try:
        await _run_similarity_detection(idea_block_id, db)
    except Exception as exc:
        logger.exception(
            "similarity_detection_failed idea_block_id=%s error_type=%s error=%s",
            idea_block_id,
            exc.__class__.__name__,
            exc,
        )
        await db.rollback()


async def _run_similarity_detection(idea_block_id: int, db: AsyncSession) -> None:
    idea_block = await db.get(IdeaBlock, idea_block_id)
    if idea_block is None:
        logger.info("similarity_detection_no_match idea_block_id=%s reason=%s", idea_block_id, "Idea block not found")
        return

    logger.info(
        "similarity_detection_start idea_block_id=%s session_name=%s user_id=%s",
        idea_block.id,
        idea_block.session_name,
        idea_block.user_id,
    )
    logger.info(
        "similarity_detection_debug_core idea_block_id=%s user_id=%s summary=%s",
        idea_block.id,
        idea_block.user_id,
        idea_block.summary,
    )

    task_item_ids = await _get_task_item_ids(idea_block, db)
    logger.info(
        "similarity_detection_task_items idea_block_id=%s task_item_ids=%s count=%s",
        idea_block.id,
        task_item_ids,
        len(task_item_ids),
    )
    if not task_item_ids:
        await _clear_similarity_for_idea_block(idea_block, "No task items", db)
        return

    if idea_block.embedding_vector is None:
        await _clear_similarity_for_idea_block(idea_block, "Missing embedding vector", db)
        return

    same_item_blocks = await _find_same_item_blocks(idea_block, task_item_ids, db)
    same_item_ids = [block.id for block in same_item_blocks]
    logger.info(
        "similarity_detection_same_item_blocks idea_block_id=%s candidate_ids=%s count=%s",
        idea_block.id,
        same_item_ids,
        len(same_item_ids),
    )
    for candidate in same_item_blocks:
        logger.info(
            "similarity_detection_debug_same_item_compare idea_block_a_id=%s idea_block_b_id=%s b_user_id=%s b_summary=%s",
            idea_block.id,
            candidate.id,
            candidate.user_id,
            candidate.summary,
        )
    if not same_item_blocks:
        await _clear_similarity_for_idea_block(idea_block, "No same-item candidates", db)
        return

    cosine_candidates = await _find_cosine_candidates(idea_block, same_item_ids, db)
    logger.info(
        "similarity_detection_cosine_candidates idea_block_id=%s candidates=%s threshold=%s",
        idea_block.id,
        [
            {"id": candidate.id, "similarity": round(score, 4)}
            for candidate, score in cosine_candidates
        ],
        COSINE_SIMILARITY_THRESHOLD,
    )
    for candidate, score in cosine_candidates:
        logger.info(
            "similarity_detection_debug_cosine_pass idea_block_a_id=%s idea_block_b_id=%s similarity=%s b_user_id=%s b_summary=%s",
            idea_block.id,
            candidate.id,
            round(score, 4),
            candidate.user_id,
            candidate.summary,
        )
    if not cosine_candidates:
        await _clear_similarity_for_idea_block(idea_block, "No cosine-similar candidates", db)
        return

    candidates = [candidate for candidate, _ in cosine_candidates]
    llm_result = await _select_first_similar_with_llm(idea_block, candidates)
    candidate_ids = {candidate.id for candidate in candidates}
    selected_id = llm_result.get("id")
    reason = str(llm_result.get("reason") or "").strip()
    is_same_reason = _coerce_bool(llm_result.get("is_same_reason"), default=True)

    if selected_id is None:
        await _clear_similarity_for_idea_block(idea_block, reason or "No similar ideas found", db)
        return
    if not isinstance(selected_id, int) or selected_id not in candidate_ids:
        await _clear_similarity_for_idea_block(
            idea_block,
            f"LLM returned invalid candidate id: {selected_id}",
            db,
        )
        return
    if _reason_rejects_similarity(reason):
        await _clear_similarity_for_idea_block(
            idea_block,
            f"LLM selected a candidate while rejecting similarity: {reason}",
            db,
        )
        return
    if not reason:
        reason = "Similarity detected by task item, cosine similarity, and LLM comparison"

    selected_candidate = next((candidate for candidate in candidates if candidate.id == selected_id), None)
    logger.info(
        "similarity_detection_debug_llm_selected idea_block_a_id=%s idea_block_b_id=%s b_user_id=%s is_same_reason=%s reason=%s b_summary=%s",
        idea_block.id,
        selected_id,
        selected_candidate.user_id if selected_candidate is not None else None,
        is_same_reason,
        reason,
        selected_candidate.summary if selected_candidate is not None else None,
    )
    await _replace_similarity_pair(idea_block, selected_id, reason, is_same_reason, db)


async def _get_task_item_ids(idea_block: IdeaBlock, db: AsyncSession) -> list[Any]:
    if idea_block.task_name == "enhance-the-poster":
        return await _get_poster_task_item_keys(idea_block.id, db)
    result = await db.execute(
        select(TaskItem.task_item_id)
        .where(TaskItem.idea_block_id == idea_block.id)
        .order_by(TaskItem.task_item_id.asc())
    )
    return list(result.scalars().all())


async def _get_poster_task_item_keys(idea_block_id: int, db: AsyncSession) -> list[tuple[str, str, str]]:
    result = await db.execute(
        select(
            PosterIdeaBlockTaskItem.poster_component,
            PosterIdeaBlockTaskItem.action,
            PosterIdeaBlockTaskItem.advanced_action,
        )
        .where(PosterIdeaBlockTaskItem.idea_block_id == idea_block_id)
        .order_by(
            PosterIdeaBlockTaskItem.poster_component.asc(),
            PosterIdeaBlockTaskItem.action.asc(),
            PosterIdeaBlockTaskItem.advanced_action.asc(),
        )
    )
    return [(component, action, advanced_action) for component, action, advanced_action in result.all()]


async def _find_same_item_blocks(
    idea_block: IdeaBlock,
    task_item_ids: list[Any],
    db: AsyncSession,
) -> list[IdeaBlock]:
    if idea_block.task_name == "enhance-the-poster":
        return await _find_same_poster_item_blocks(idea_block, task_item_ids, db)

    id_result = await db.execute(
        select(distinct(IdeaBlock.id))
        .join(TaskItem, TaskItem.idea_block_id == IdeaBlock.id)
        .where(
            IdeaBlock.session_name == idea_block.session_name,
            IdeaBlock.task_name == idea_block.task_name,
            IdeaBlock.user_id != idea_block.user_id,
            IdeaBlock.id != idea_block.id,
            IdeaBlock.embedding_vector.is_not(None),
            TaskItem.task_item_id.in_(task_item_ids),
        )
        .order_by(IdeaBlock.id.desc())
    )
    idea_block_ids = list(id_result.scalars().all())
    if not idea_block_ids:
        return []

    result = await db.execute(
        select(IdeaBlock)
        .where(IdeaBlock.id.in_(idea_block_ids))
        .order_by(IdeaBlock.id.desc())
    )
    return list(result.scalars().all())


async def _find_same_poster_item_blocks(
    idea_block: IdeaBlock,
    task_item_keys: list[tuple[str, str, str]],
    db: AsyncSession,
) -> list[IdeaBlock]:
    candidate_ids: set[int] = set()
    for poster_component, action, advanced_action in task_item_keys:
        result = await db.execute(
            select(distinct(IdeaBlock.id))
            .join(PosterIdeaBlockTaskItem, PosterIdeaBlockTaskItem.idea_block_id == IdeaBlock.id)
            .where(
                IdeaBlock.session_name == idea_block.session_name,
                IdeaBlock.task_name == idea_block.task_name,
                IdeaBlock.user_id != idea_block.user_id,
                IdeaBlock.id != idea_block.id,
                IdeaBlock.embedding_vector.is_not(None),
                PosterIdeaBlockTaskItem.poster_component == poster_component,
                PosterIdeaBlockTaskItem.action == action,
                PosterIdeaBlockTaskItem.advanced_action == advanced_action,
            )
        )
        candidate_ids.update(result.scalars().all())

    if not candidate_ids:
        return []

    result = await db.execute(
        select(IdeaBlock)
        .where(IdeaBlock.id.in_(candidate_ids))
        .order_by(IdeaBlock.id.desc())
    )
    return list(result.scalars().all())


async def _find_cosine_candidates(
    idea_block: IdeaBlock,
    same_item_ids: list[int],
    db: AsyncSession,
) -> list[tuple[IdeaBlock, float]]:
    distance = IdeaBlock.embedding_vector.cosine_distance(idea_block.embedding_vector)
    similarity_score = (1 - distance).label("similarity_score")
    result = await db.execute(
        select(IdeaBlock, similarity_score)
        .where(
            IdeaBlock.id.in_(same_item_ids),
            IdeaBlock.embedding_vector.is_not(None),
            distance < COSINE_DISTANCE_THRESHOLD,
        )
        .order_by(IdeaBlock.id.desc())
    )
    return [(idea, float(score)) for idea, score in result.all()]


async def _select_first_similar_with_llm(idea_block: IdeaBlock, candidates: list[IdeaBlock]) -> dict[str, Any]:
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required for similarity detection")

    system_prompt = get_task_prompt_config(idea_block.task_name).similarity_system_prompt
    ideas_list = "\n".join(
        f"- ID: {candidate.id}\n  Summary: {candidate.summary}"
        for candidate in candidates
    )
    user_prompt = f"""
# Input Section
### [核心想法 A]
ID: {idea_block.id}
Summary: {idea_block.summary}

### [候選想法列表]
{ideas_list}

---

# Output (JSON Only)
""".strip()
    logger.info(
        "similarity_detection_llm_request idea_block_id=%s candidate_ids=%s prompt_chars=%s",
        idea_block.id,
        [candidate.id for candidate in candidates],
        len(system_prompt) + len(user_prompt),
    )
    completion = await openai_client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw_content = completion.choices[0].message.content or "{}"
    parsed = _parse_llm_json_payload(raw_content)
    logger.info(
        "similarity_detection_llm_response idea_block_id=%s response_chars=%s parsed_id=%s is_same_reason=%s reason=%s",
        idea_block.id,
        len(raw_content),
        parsed.get("id") if isinstance(parsed, dict) else None,
        parsed.get("is_same_reason") if isinstance(parsed, dict) else None,
        parsed.get("reason") if isinstance(parsed, dict) else None,
    )
    if not isinstance(parsed, dict):
        return {"id": None, "reason": "No similar ideas found", "is_same_reason": False}
    return parsed


async def _replace_similarity_pair(
    idea_block: IdeaBlock,
    similar_idea_block_id: int,
    reason: str,
    is_same_reason: bool,
    db: AsyncSession,
) -> None:
    similar_idea_block = await db.get(IdeaBlock, similar_idea_block_id)
    if similar_idea_block is None:
        await _clear_similarity_for_idea_block(
            idea_block,
            f"Selected similar idea block not found: {similar_idea_block_id}",
            db,
        )
        return

    deleted_count = await _delete_pairs_for_idea_block(idea_block.id, db)
    similarity = Similarity(
        idea_block_id_1=idea_block.id,
        idea_block_id_2=similar_idea_block_id,
        reason=reason,
        is_same_reason=is_same_reason,
    )
    db.add(similarity)
    idea_block.similarity_id = similar_idea_block_id
    similar_idea_block.similarity_id = idea_block.id
    await db.flush()
    logger.info(
        "similarity_detection_pair_deleted idea_block_id=%s deleted_count=%s",
        idea_block.id,
        deleted_count,
    )
    logger.info(
        (
            "similarity_detection_pair_created idea_block_id=%s idea_block_user_id=%s "
            "idea_block_similarity_id=%s similar_idea_block_id=%s similar_idea_block_user_id=%s "
            "similar_idea_block_similarity_id=%s similarity_id=%s is_same_reason=%s"
        ),
        idea_block.id,
        idea_block.user_id,
        idea_block.similarity_id,
        similar_idea_block_id,
        similar_idea_block.user_id,
        similar_idea_block.similarity_id,
        similarity.id,
        similarity.is_same_reason,
    )
    await db.commit()
    await db.refresh(idea_block)
    await db.refresh(similar_idea_block)
    await db.refresh(similarity)
    try:
        await notify_similarity_cue_for_blocks(
            similarity_id=similarity.id,
            is_same_reason=similarity.is_same_reason,
            idea_a=idea_block,
            idea_b=similar_idea_block,
        )
    except Exception as exc:
        logger.warning(
            "similarity_detection_notify_failed similarity_id=%s idea_block_id=%s similar_idea_block_id=%s error_type=%s error=%s",
            similarity.id,
            idea_block.id,
            similar_idea_block.id,
            exc.__class__.__name__,
            exc,
        )


async def _clear_similarity_for_idea_block(idea_block: IdeaBlock, reason: str, db: AsyncSession) -> None:
    deleted_count = await _delete_pairs_for_idea_block(idea_block.id, db)
    idea_block.similarity_id = None
    logger.info(
        "similarity_detection_pair_deleted idea_block_id=%s deleted_count=%s",
        idea_block.id,
        deleted_count,
    )
    logger.info(
        "similarity_detection_no_match idea_block_id=%s reason=%s",
        idea_block.id,
        reason or "No similar ideas found",
    )
    await db.commit()


async def _delete_pairs_for_idea_block(idea_block_id: int, db: AsyncSession) -> int:
    result = await db.execute(
        delete(Similarity).where(
            or_(
                Similarity.idea_block_id_1 == idea_block_id,
                Similarity.idea_block_id_2 == idea_block_id,
            )
        )
    )
    await db.execute(
        update(IdeaBlock)
        .where(IdeaBlock.similarity_id == idea_block_id)
        .values(similarity_id=None)
    )
    return int(result.rowcount or 0)


def _parse_llm_json_payload(raw_content: str) -> Any:
    text = raw_content.strip()
    if not text:
        return {}

    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()

    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start == -1:
        return {}
    sliced = text[start:]

    for end in range(len(sliced), 0, -1):
        candidate = sliced[:end].strip()
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    return {}


def _coerce_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
    return default


def _reason_rejects_similarity(reason: str) -> bool:
    normalized = reason.casefold()
    if not normalized:
        return False

    rejection_markers = (
        "not similar",
        "no similar",
        "not the same",
        "opposite conclusion",
        "opposite conclusions",
        "opposite ranking",
        "opposite rankings",
        "opposite priority",
        "opposite priorities",
        "contradictory",
        "contradict",
        "conflict",
        "different conclusion",
        "different conclusions",
        "相反",
        "不相似",
        "不同",
        "衝突",
        "矛盾",
    )
    return any(marker in normalized for marker in rejection_markers)
