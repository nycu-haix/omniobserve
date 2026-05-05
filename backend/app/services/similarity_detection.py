import json
import os
import re
from typing import Any

from sqlalchemy import delete, distinct, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import IdeaBlock, Similarity, TaskItem

COSINE_SIMILARITY_THRESHOLD = 0.7
COSINE_DISTANCE_THRESHOLD = 1 - COSINE_SIMILARITY_THRESHOLD

SIMILARITY_SYSTEM_PROMPT = """
# Role
你是一位精通海上求生策略與語意邏輯分析的助手。你的任務是從「候選想法列表」中，找出**第一個**在「生存邏輯」上與「核心想法 A」相似的想法。

# Task Context: 海上求生 (Lost at Sea)
參與者正在針對 15 項工具進行排序，分析必須基於海上漂流情境：
- 蚊帳 (mosquito_net)、一罐汽油 (petrol)、裝水容器 (water_container)、刮鬍鏡 (shaving_mirror)、六分儀 (sextant)、緊急口糧 (emergency_rations)、海圖 (sea_chart)、漂浮坐墊 (floating_cushion)、繩子 (rope)、巧克力棒 (chocolate_bars)、防水布 (waterproof_sheet)、釣魚竿 (fishing_rod)、驅鯊劑 (shark_repellent)、一瓶蘭姆酒 (rum)、VHF 無線電 (vhf_radio)。

# Similarity Criteria (判定標準)
1. **意圖一致**：使用目的（例：求救、防護、飲食、導航）相同。
2. **立場對齊**：必須同為支持或同為反對。若立場衝突（一要帶一不帶），判定為不相似。
3. **邏輯連貫**：即使措辭不同，只要核心生存邏輯指向同一結果，即視為相似。

# Output Requirements
1. 按列表順序比對，**僅找出第一個**符合相似標準的想法。
2. 輸出該想法的 `id` 以及具體的 `reason`（簡述兩者邏輯如何重疊）。
3. 如果完全沒有相似的想法，`id` 請回傳 `null`，`reason` 回傳 "No similar ideas found"。
4. **僅輸出 JSON 格式**，不要包含任何解釋文字。
""".strip()


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

    task_item_ids = await _get_task_item_ids(idea_block.id, db)
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
    if not reason:
        reason = "Similarity detected by task item, cosine similarity, and LLM comparison"

    selected_candidate = next((candidate for candidate in candidates if candidate.id == selected_id), None)
    logger.info(
        "similarity_detection_debug_llm_selected idea_block_a_id=%s idea_block_b_id=%s b_user_id=%s reason=%s b_summary=%s",
        idea_block.id,
        selected_id,
        selected_candidate.user_id if selected_candidate is not None else None,
        reason,
        selected_candidate.summary if selected_candidate is not None else None,
    )
    await _replace_similarity_pair(idea_block, selected_id, reason, db)


async def _get_task_item_ids(idea_block_id: int, db: AsyncSession) -> list[int]:
    result = await db.execute(
        select(TaskItem.task_item_id)
        .where(TaskItem.idea_block_id == idea_block_id)
        .order_by(TaskItem.task_item_id.asc())
    )
    return list(result.scalars().all())


async def _find_same_item_blocks(
    idea_block: IdeaBlock,
    task_item_ids: list[int],
    db: AsyncSession,
) -> list[IdeaBlock]:
    id_result = await db.execute(
        select(distinct(IdeaBlock.id))
        .join(TaskItem, TaskItem.idea_block_id == IdeaBlock.id)
        .where(
            IdeaBlock.session_name == idea_block.session_name,
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
        len(SIMILARITY_SYSTEM_PROMPT) + len(user_prompt),
    )
    completion = await openai_client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": SIMILARITY_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw_content = completion.choices[0].message.content or "{}"
    parsed = _parse_llm_json_payload(raw_content)
    logger.info(
        "similarity_detection_llm_response idea_block_id=%s response_chars=%s parsed_id=%s reason=%s",
        idea_block.id,
        len(raw_content),
        parsed.get("id") if isinstance(parsed, dict) else None,
        parsed.get("reason") if isinstance(parsed, dict) else None,
    )
    if not isinstance(parsed, dict):
        return {"id": None, "reason": "No similar ideas found"}
    return parsed


async def _replace_similarity_pair(
    idea_block: IdeaBlock,
    similar_idea_block_id: int,
    reason: str,
    db: AsyncSession,
) -> None:
    deleted_count = await _delete_pairs_for_idea_block(idea_block.id, db)
    similarity = Similarity(
        idea_block_id_1=idea_block.id,
        idea_block_id_2=similar_idea_block_id,
        reason=reason,
    )
    db.add(similarity)
    idea_block.similarity_id = similar_idea_block_id
    await db.flush()
    logger.info(
        "similarity_detection_pair_deleted idea_block_id=%s deleted_count=%s",
        idea_block.id,
        deleted_count,
    )
    logger.info(
        "similarity_detection_pair_created idea_block_id=%s similar_idea_block_id=%s similarity_id=%s",
        idea_block.id,
        similar_idea_block_id,
        similarity.id,
    )
    await db.commit()


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
