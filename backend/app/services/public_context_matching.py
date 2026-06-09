import json
import os
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import IdeaBlock, TaskItem
from .embedding_service import create_text_embedding
from .task_item_generation import build_task_item_ids_with_llm

PUBLIC_CONTEXT_SIMILARITY_THRESHOLD = 0.74
PUBLIC_CONTEXT_DISTANCE_THRESHOLD = 1 - PUBLIC_CONTEXT_SIMILARITY_THRESHOLD
PUBLIC_CONTEXT_MAX_MATCHES = 3
PUBLIC_CONTEXT_LLM_CANDIDATE_LIMIT = 12


@dataclass(frozen=True)
class PublicContextMatch:
    idea_block_id: int
    user_id: int
    score: float | None
    reason: str
    task_item_ids: list[int]


async def find_public_context_matches(
    db: AsyncSession,
    *,
    session_name: str,
    public_text: str,
) -> list[PublicContextMatch]:
    normalized_text = public_text.strip()
    if not normalized_text:
        return []

    task_item_ids = await build_task_item_ids_with_llm(normalized_text, session_name=session_name)
    if not task_item_ids:
        logger.info(
            "public_context_match_skipped session_name=%s reason=%s text_chars=%s",
            session_name,
            "no_task_items",
            len(normalized_text),
        )
        return []

    candidate_ids = await _find_same_task_item_candidate_ids(
        db,
        session_name=session_name,
        task_item_ids=task_item_ids,
    )
    if not candidate_ids:
        logger.info(
            "public_context_match_skipped session_name=%s reason=%s task_item_ids=%s",
            session_name,
            "no_same_item_candidates",
            task_item_ids,
        )
        return []

    try:
        embedding_vector = await create_text_embedding(
            normalized_text,
            log_failures=False,
            retry_attempts=1,
        )
    except Exception as exc:
        logger.info(
            "public_context_match_embedding_failed session_name=%s fallback=%s task_item_ids=%s candidate_count=%s error_type=%s error=%s",
            session_name,
            "llm_verifier",
            task_item_ids,
            len(candidate_ids),
            exc.__class__.__name__,
            exc,
        )
        return await _find_llm_verified_matches(
            db,
            session_name=session_name,
            public_text=normalized_text,
            candidate_idea_block_ids=candidate_ids,
            task_item_ids=task_item_ids,
        )

    semantic_matches = await _find_semantic_matches(
        db,
        session_name=session_name,
        embedding_vector=embedding_vector,
        candidate_idea_block_ids=candidate_ids,
        task_item_ids=task_item_ids,
    )
    matches = semantic_matches[:PUBLIC_CONTEXT_MAX_MATCHES]
    logger.info(
        "public_context_match_done session_name=%s task_item_ids=%s candidate_count=%s semantic_match_count=%s match_count=%s threshold=%s max_matches=%s",
        session_name,
        task_item_ids,
        len(candidate_ids),
        len(semantic_matches),
        len(matches),
        PUBLIC_CONTEXT_SIMILARITY_THRESHOLD,
        PUBLIC_CONTEXT_MAX_MATCHES,
    )
    return matches


async def _find_same_task_item_candidate_ids(
    db: AsyncSession,
    *,
    session_name: str,
    task_item_ids: list[int],
) -> list[int]:
    result = await db.execute(
        select(distinct(IdeaBlock.id))
        .join(TaskItem, TaskItem.idea_block_id == IdeaBlock.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.is_deleted.is_(False),
            TaskItem.task_item_id.in_(task_item_ids),
        )
        .order_by(IdeaBlock.id.desc())
    )
    return list(result.scalars().all())


async def _find_llm_verified_matches(
    db: AsyncSession,
    *,
    session_name: str,
    public_text: str,
    candidate_idea_block_ids: list[int],
    task_item_ids: list[int],
) -> list[PublicContextMatch]:
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        logger.info(
            "public_context_match_skipped session_name=%s reason=%s task_item_ids=%s candidate_count=%s",
            session_name,
            "embedding_failed_and_openai_missing",
            task_item_ids,
            len(candidate_idea_block_ids),
        )
        return []

    candidates = await _find_candidate_blocks(
        db,
        candidate_idea_block_ids=candidate_idea_block_ids,
        limit=PUBLIC_CONTEXT_LLM_CANDIDATE_LIMIT,
    )
    if not candidates:
        return []

    ideas_list = "\n".join(
        f"- ID: {candidate.id}\n  Summary: {_truncate(candidate.summary)}"
        for candidate in candidates
    )
    system_prompt = """
You decide which private idea blocks are currently relevant to a live public discussion.

Select a candidate only when the public discussion and the idea block describe the same concrete poster-improvement issue, compatible edit direction, or directly connected design rationale.

Do not select a candidate merely because it mentions the same broad poster component or task item.
Do not select generic matches where the public discussion and idea block would not help the participant join the current conversation.

Return JSON only in this shape:
{"matches":[{"id":123,"reason":"brief reason"}]}

Return at most 3 matches. If none are genuinely relevant, return {"matches":[]}.
""".strip()
    user_prompt = f"""
# Public discussion context
{public_text}

# Candidate idea blocks
{ideas_list}
""".strip()

    try:
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
    except Exception as exc:
        logger.info(
            "public_context_match_skipped session_name=%s reason=%s task_item_ids=%s candidate_count=%s error_type=%s error=%s",
            session_name,
            "llm_fallback_failed",
            task_item_ids,
            len(candidates),
            exc.__class__.__name__,
            exc,
        )
        return []

    matches = _normalize_llm_matches(parsed, candidates=candidates, task_item_ids=task_item_ids)
    logger.info(
        "public_context_match_llm_fallback_done session_name=%s task_item_ids=%s candidate_count=%s match_count=%s max_matches=%s",
        session_name,
        task_item_ids,
        len(candidates),
        len(matches),
        PUBLIC_CONTEXT_MAX_MATCHES,
    )
    return matches


async def _find_candidate_blocks(
    db: AsyncSession,
    *,
    candidate_idea_block_ids: list[int],
    limit: int,
) -> list[IdeaBlock]:
    result = await db.execute(
        select(IdeaBlock)
        .where(
            IdeaBlock.id.in_(candidate_idea_block_ids),
            IdeaBlock.is_deleted.is_(False),
        )
        .order_by(IdeaBlock.id.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def _find_semantic_matches(
    db: AsyncSession,
    *,
    session_name: str,
    embedding_vector: list[float],
    candidate_idea_block_ids: list[int],
    task_item_ids: list[int],
) -> list[PublicContextMatch]:
    distance = IdeaBlock.embedding_vector.cosine_distance(embedding_vector)
    similarity_score = (1 - distance).label("similarity_score")
    result = await db.execute(
        select(IdeaBlock, similarity_score)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.is_deleted.is_(False),
            IdeaBlock.id.in_(candidate_idea_block_ids),
            IdeaBlock.embedding_vector.is_not(None),
            distance < PUBLIC_CONTEXT_DISTANCE_THRESHOLD,
        )
        .order_by(similarity_score.desc(), IdeaBlock.id.desc())
    )
    return [
        PublicContextMatch(
            idea_block_id=idea_block.id,
            user_id=idea_block.user_id,
            score=float(similarity),
            reason="same task item + semantic similarity",
            task_item_ids=task_item_ids,
        )
        for idea_block, similarity in result.all()
    ]


def _normalize_llm_matches(
    parsed: Any,
    *,
    candidates: list[IdeaBlock],
    task_item_ids: list[int],
) -> list[PublicContextMatch]:
    if not isinstance(parsed, dict):
        return []
    raw_matches = parsed.get("matches")
    if not isinstance(raw_matches, list):
        return []

    candidates_by_id = {candidate.id: candidate for candidate in candidates}
    matches: list[PublicContextMatch] = []
    seen_ids: set[int] = set()
    for raw_match in raw_matches:
        if not isinstance(raw_match, dict):
            continue
        match_id = raw_match.get("id")
        if isinstance(match_id, str) and match_id.isdigit():
            match_id = int(match_id)
        if not isinstance(match_id, int) or match_id in seen_ids:
            continue
        candidate = candidates_by_id.get(match_id)
        if candidate is None:
            continue
        seen_ids.add(match_id)
        reason = str(raw_match.get("reason") or "same task item + LLM relevance").strip()
        matches.append(
            PublicContextMatch(
                idea_block_id=candidate.id,
                user_id=candidate.user_id,
                score=None,
                reason=f"same task item + LLM relevance: {reason}",
                task_item_ids=task_item_ids,
            )
        )
        if len(matches) >= PUBLIC_CONTEXT_MAX_MATCHES:
            break

    return matches


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


def _truncate(text: str, limit: int = 300) -> str:
    value = text.strip()
    if len(value) <= limit:
        return value
    return f"{value[:limit].rstrip()}..."
