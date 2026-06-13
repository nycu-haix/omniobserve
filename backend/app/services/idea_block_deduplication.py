from dataclasses import dataclass
import json
import os
import re
import time
import unicodedata
from typing import Any, Protocol

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import IdeaBlock, TaskItem

DEDUPLICATION_SIMILARITY_THRESHOLD = 0.85
DEDUPLICATION_CANDIDATE_LIMIT = 5
DEDUPLICATION_FALLBACK_SIMILARITY_THRESHOLD = 0.90
DEDUPLICATION_FALLBACK_RECENT_CANDIDATE_LIMIT = 20


@dataclass(frozen=True)
class DuplicateIdeaBlockMatch:
    idea_block_id: int
    reason: str
    similarity: float | None = None


@dataclass(frozen=True)
class SemanticCandidateSearchResult:
    candidates: list[tuple[IdeaBlock, float]]
    best_candidate_id: int | None
    best_similarity: float | None


class DeduplicationStageRecorder(Protocol):
    def __call__(
        self,
        stage: str,
        started_perf: float,
        *,
        candidate_count: int | None = None,
        llm_model: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        ...


async def find_duplicate_idea_block(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    title: str,
    summary: str,
    embedding_vector: list[float] | None,
    task_item_ids: list[int],
    record_stage: DeduplicationStageRecorder | None = None,
) -> DuplicateIdeaBlockMatch | None:
    logger.info(
        (
            "idea_block_dedup_start session_name=%s user_id=%s title_chars=%s summary_chars=%s "
            "has_embedding=%s task_item_ids=%s"
        ),
        session_name,
        user_id,
        len(title),
        len(summary),
        embedding_vector is not None,
        task_item_ids,
    )
    exact_match = await _find_exact_text_match(
        db,
        session_name=session_name,
        user_id=user_id,
        title=title,
        summary=summary,
    )
    if exact_match is not None:
        logger.info(
            "idea_block_dedup_exact_match session_name=%s user_id=%s duplicate_id=%s",
            session_name,
            user_id,
            exact_match.id,
        )
        return DuplicateIdeaBlockMatch(
            idea_block_id=exact_match.id,
            reason="normalized text match",
            similarity=1.0,
        )

    normalized_task_item_ids = _normalize_task_item_ids(task_item_ids)
    if embedding_vector is None:
        logger.info(
            "idea_block_dedup_skipped session_name=%s user_id=%s reason=missing_embedding task_item_count=%s",
            session_name,
            user_id,
            len(normalized_task_item_ids),
        )
        return None

    same_item_block_ids: list[int] = []
    if normalized_task_item_ids:
        same_item_started = time.perf_counter()
        same_item_block_ids = await _find_same_task_item_block_ids(
            db,
            session_name=session_name,
            user_id=user_id,
            task_item_ids=normalized_task_item_ids,
        )
        if record_stage is not None:
            record_stage(
                "dedupe_candidate_query",
                same_item_started,
                candidate_count=len(same_item_block_ids),
                metadata={"source": "same_task_item", "task_item_count": len(normalized_task_item_ids)},
            )
    else:
        logger.info(
            "idea_block_dedup_task_item_gate_skipped session_name=%s user_id=%s reason=no_task_items",
            session_name,
            user_id,
        )
        if record_stage is not None:
            record_stage(
                "dedupe_candidate_query",
                time.perf_counter(),
                candidate_count=0,
                metadata={"source": "same_task_item", "task_item_count": 0, "skipped_reason": "no_task_items"},
            )

    semantic_started = time.perf_counter()
    same_item_result = await _find_semantic_candidates(
        db,
        session_name=session_name,
        user_id=user_id,
        embedding_vector=embedding_vector,
        candidate_idea_block_ids=same_item_block_ids,
        threshold=DEDUPLICATION_SIMILARITY_THRESHOLD,
    )
    if record_stage is not None:
        record_stage(
            "dedupe_candidate_query",
            semantic_started,
            candidate_count=len(same_item_block_ids),
            metadata={
                "source": "same_task_item_semantic",
                "accepted_count": len(same_item_result.candidates),
                "best_candidate_id": same_item_result.best_candidate_id,
                "best_similarity": same_item_result.best_similarity,
                "threshold": DEDUPLICATION_SIMILARITY_THRESHOLD,
            },
        )
    _log_candidate_search(
        session_name=session_name,
        user_id=user_id,
        source="same_task_item",
        candidate_count=len(same_item_block_ids),
        threshold=DEDUPLICATION_SIMILARITY_THRESHOLD,
        result=same_item_result,
    )

    semantic_candidates = same_item_result.candidates
    candidate_source = "same_task_item"
    threshold = DEDUPLICATION_SIMILARITY_THRESHOLD
    if not semantic_candidates:
        fallback_started = time.perf_counter()
        fallback_block_ids = await _find_recent_block_ids(
            db,
            session_name=session_name,
            user_id=user_id,
            limit=DEDUPLICATION_FALLBACK_RECENT_CANDIDATE_LIMIT,
        )
        if record_stage is not None:
            record_stage(
                "dedupe_candidate_query",
                fallback_started,
                candidate_count=len(fallback_block_ids),
                metadata={"source": "recent_fallback", "limit": DEDUPLICATION_FALLBACK_RECENT_CANDIDATE_LIMIT},
            )
        fallback_semantic_started = time.perf_counter()
        fallback_result = await _find_semantic_candidates(
            db,
            session_name=session_name,
            user_id=user_id,
            embedding_vector=embedding_vector,
            candidate_idea_block_ids=fallback_block_ids,
            threshold=DEDUPLICATION_FALLBACK_SIMILARITY_THRESHOLD,
        )
        if record_stage is not None:
            record_stage(
                "dedupe_candidate_query",
                fallback_semantic_started,
                candidate_count=len(fallback_block_ids),
                metadata={
                    "source": "recent_fallback_semantic",
                    "accepted_count": len(fallback_result.candidates),
                    "best_candidate_id": fallback_result.best_candidate_id,
                    "best_similarity": fallback_result.best_similarity,
                    "threshold": DEDUPLICATION_FALLBACK_SIMILARITY_THRESHOLD,
                },
            )
        _log_candidate_search(
            session_name=session_name,
            user_id=user_id,
            source="recent_fallback",
            candidate_count=len(fallback_block_ids),
            threshold=DEDUPLICATION_FALLBACK_SIMILARITY_THRESHOLD,
            result=fallback_result,
        )
        semantic_candidates = fallback_result.candidates
        candidate_source = "recent_fallback"
        threshold = DEDUPLICATION_FALLBACK_SIMILARITY_THRESHOLD

    if not semantic_candidates:
        logger.info(
            (
                "idea_block_dedup_no_match session_name=%s user_id=%s reason=no_semantic_candidate "
                "same_item_count=%s threshold=%s fallback_threshold=%s"
            ),
            session_name,
            user_id,
            len(same_item_block_ids),
            DEDUPLICATION_SIMILARITY_THRESHOLD,
            DEDUPLICATION_FALLBACK_SIMILARITY_THRESHOLD,
        )
        return None

    llm_started = time.perf_counter()
    confirmed_match = await _select_duplicate_with_llm(
        summary=summary,
        candidates=semantic_candidates,
    )
    if record_stage is not None:
        record_stage(
            "dedupe_llm_compare",
            llm_started,
            candidate_count=len(semantic_candidates),
            llm_model=OPENAI_MODEL,
            metadata={
                "candidate_source": candidate_source,
                "candidate_ids": [candidate.id for candidate, _ in semantic_candidates],
                "matched": confirmed_match is not None,
            },
        )
    if confirmed_match is None:
        logger.info(
            (
                "idea_block_dedup_semantic_rejected session_name=%s user_id=%s source=%s "
                "candidate_ids=%s best_similarity=%s threshold=%s"
            ),
            session_name,
            user_id,
            candidate_source,
            [candidate.id for candidate, _ in semantic_candidates],
            round(semantic_candidates[0][1], 4),
            threshold,
        )
        return None

    matched_block, similarity, reason = confirmed_match
    logger.info(
        "idea_block_dedup_semantic_match session_name=%s user_id=%s source=%s duplicate_id=%s similarity=%s threshold=%s",
        session_name,
        user_id,
        candidate_source,
        matched_block.id,
        round(similarity, 4),
        threshold,
    )
    return DuplicateIdeaBlockMatch(
        idea_block_id=matched_block.id,
        reason=reason or ("shared task item semantic duplicate" if candidate_source == "same_task_item" else "recent semantic duplicate"),
        similarity=similarity,
    )


async def _find_exact_text_match(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    title: str,
    summary: str,
) -> IdeaBlock | None:
    normalized_title = _normalize_dedup_text(title)
    normalized_summary = _normalize_dedup_text(summary)
    if not normalized_title and not normalized_summary:
        return None

    result = await db.execute(
        select(IdeaBlock)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            IdeaBlock.is_deleted.is_(False),
        )
        .order_by(IdeaBlock.id.desc())
    )
    for candidate in result.scalars().all():
        candidate_title = _normalize_dedup_text(candidate.title)
        candidate_summary = _normalize_dedup_text(candidate.summary)
        if normalized_summary and normalized_summary == candidate_summary:
            return candidate
        if normalized_title and normalized_title == candidate_title and normalized_summary == candidate_summary:
            return candidate

    return None


async def _find_same_task_item_block_ids(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    task_item_ids: list[int],
) -> list[int]:
    result = await db.execute(
        select(distinct(IdeaBlock.id))
        .join(TaskItem, TaskItem.idea_block_id == IdeaBlock.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            IdeaBlock.is_deleted.is_(False),
            IdeaBlock.embedding_vector.is_not(None),
            TaskItem.task_item_id.in_(task_item_ids),
        )
        .order_by(IdeaBlock.id.desc())
    )
    return list(result.scalars().all())


async def _find_recent_block_ids(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    limit: int,
) -> list[int]:
    result = await db.execute(
        select(IdeaBlock.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            IdeaBlock.is_deleted.is_(False),
            IdeaBlock.embedding_vector.is_not(None),
        )
        .order_by(IdeaBlock.id.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def _find_semantic_candidates(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    embedding_vector: list[float],
    candidate_idea_block_ids: list[int],
    threshold: float,
) -> SemanticCandidateSearchResult:
    if not candidate_idea_block_ids:
        return SemanticCandidateSearchResult(candidates=[], best_candidate_id=None, best_similarity=None)

    distance = IdeaBlock.embedding_vector.cosine_distance(embedding_vector)
    similarity_score = (1 - distance).label("similarity_score")
    result = await db.execute(
        select(IdeaBlock, similarity_score)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            IdeaBlock.is_deleted.is_(False),
            IdeaBlock.id.in_(candidate_idea_block_ids),
            IdeaBlock.embedding_vector.is_not(None),
        )
        .order_by(similarity_score.desc(), IdeaBlock.id.desc())
        .limit(DEDUPLICATION_CANDIDATE_LIMIT)
    )
    scored_candidates = [(idea_block, float(similarity)) for idea_block, similarity in result.all()]
    best_candidate = scored_candidates[0] if scored_candidates else None
    return SemanticCandidateSearchResult(
        candidates=[(idea_block, similarity) for idea_block, similarity in scored_candidates if similarity >= threshold],
        best_candidate_id=best_candidate[0].id if best_candidate else None,
        best_similarity=best_candidate[1] if best_candidate else None,
    )


def _log_candidate_search(
    *,
    session_name: str,
    user_id: int,
    source: str,
    candidate_count: int,
    threshold: float,
    result: SemanticCandidateSearchResult,
) -> None:
    logger.info(
        (
            "idea_block_dedup_candidates session_name=%s user_id=%s source=%s "
            "candidate_count=%s accepted_count=%s accepted_ids=%s best_candidate_id=%s best_similarity=%s threshold=%s"
        ),
        session_name,
        user_id,
        source,
        candidate_count,
        len(result.candidates),
        [candidate.id for candidate, _ in result.candidates],
        result.best_candidate_id,
        round(result.best_similarity, 4) if result.best_similarity is not None else None,
        threshold,
    )


async def _select_duplicate_with_llm(
    *,
    summary: str,
    candidates: list[tuple[IdeaBlock, float]],
) -> tuple[IdeaBlock, float, str] | None:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        logger.info(
            "idea_block_dedup_llm_skipped reason=missing_openai_api_key candidate_ids=%s",
            [candidate.id for candidate, _ in candidates],
        )
        return None

    candidates_by_id = {candidate.id: (candidate, similarity) for candidate, similarity in candidates}
    candidate_lines = "\n".join(
        f"- ID: {candidate.id}; cosine_similarity={similarity:.4f}; summary={candidate.summary}"
        for candidate, similarity in candidates
    )
    system_prompt = (
        "You decide whether a newly generated idea block is a duplicate of one existing candidate. "
        "A duplicate must express the same concrete idea, decision target, ranking stance, and primary rationale. "
        "Do not mark ideas as duplicates merely because they mention the same task item, use similar wording, or are both broadly positive/negative. "
        "If the candidate has a different recommendation, comparison direction, uncertainty, or rationale, return null. "
        'Return only JSON in this exact shape: {"id": 123 or null, "reason": "..."} .'
    )
    user_prompt = f"New idea summary:\n{summary}\n\nCandidate existing ideas:\n{candidate_lines}"

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
        logger.exception(
            "idea_block_dedup_llm_failed model=%s candidate_ids=%s error_type=%s error=%s",
            OPENAI_MODEL,
            list(candidates_by_id),
            exc.__class__.__name__,
            exc,
        )
        return None

    if not isinstance(parsed, dict):
        return None

    selected_id = parsed.get("id")
    if selected_id is None:
        return None
    if not isinstance(selected_id, int) or selected_id not in candidates_by_id:
        logger.info(
            "idea_block_dedup_llm_invalid_id selected_id=%s candidate_ids=%s",
            selected_id,
            list(candidates_by_id),
        )
        return None

    reason = str(parsed.get("reason") or "").strip()
    candidate, similarity = candidates_by_id[selected_id]
    return candidate, similarity, reason


def _parse_llm_json_payload(raw_content: str) -> object:
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

    start_object = text.find("{")
    start_array = text.find("[")
    starts = [idx for idx in (start_object, start_array) if idx != -1]
    if not starts:
        raise json.JSONDecodeError("No JSON object/array found", text, 0)
    start = min(starts)
    sliced = text[start:]

    for end in range(len(sliced), 0, -1):
        candidate = sliced[:end].strip()
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise json.JSONDecodeError("Unable to parse JSON payload", text, start)


def _normalize_dedup_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(
        char
        for char in normalized
        if not char.isspace() and not unicodedata.category(char).startswith("P")
    )


def _normalize_task_item_ids(task_item_ids: list[int]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for task_item_id in task_item_ids:
        if not isinstance(task_item_id, int) or task_item_id in seen:
            continue
        seen.add(task_item_id)
        normalized.append(task_item_id)
    return normalized
