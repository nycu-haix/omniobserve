from dataclasses import dataclass
import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock

DEDUPLICATION_SIMILARITY_THRESHOLD = 0.92
DEDUPLICATION_DISTANCE_THRESHOLD = 1 - DEDUPLICATION_SIMILARITY_THRESHOLD


@dataclass(frozen=True)
class DuplicateIdeaBlockMatch:
    idea_block_id: int
    reason: str
    similarity: float | None = None


async def find_duplicate_idea_block(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    task_name: str,
    title: str,
    summary: str,
    embedding_vector: list[float] | None,
) -> DuplicateIdeaBlockMatch | None:
    exact_match = await _find_exact_text_match(
        db,
        session_name=session_name,
        user_id=user_id,
        task_name=task_name,
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

    if embedding_vector is None:
        return None

    semantic_match = await _find_semantic_match(
        db,
        session_name=session_name,
        user_id=user_id,
        task_name=task_name,
        embedding_vector=embedding_vector,
    )
    if semantic_match is None:
        return None

    matched_block, similarity = semantic_match
    logger.info(
        "idea_block_dedup_semantic_match session_name=%s user_id=%s duplicate_id=%s similarity=%s threshold=%s",
        session_name,
        user_id,
        matched_block.id,
        round(similarity, 4),
        DEDUPLICATION_SIMILARITY_THRESHOLD,
    )
    return DuplicateIdeaBlockMatch(
        idea_block_id=matched_block.id,
        reason="semantic similarity",
        similarity=similarity,
    )


async def _find_exact_text_match(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    task_name: str,
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
            IdeaBlock.task_name == task_name,
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


async def _find_semantic_match(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    task_name: str,
    embedding_vector: list[float],
) -> tuple[IdeaBlock, float] | None:
    distance = IdeaBlock.embedding_vector.cosine_distance(embedding_vector)
    similarity_score = (1 - distance).label("similarity_score")
    result = await db.execute(
        select(IdeaBlock, similarity_score)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            IdeaBlock.task_name == task_name,
            IdeaBlock.is_deleted.is_(False),
            IdeaBlock.embedding_vector.is_not(None),
            distance < DEDUPLICATION_DISTANCE_THRESHOLD,
        )
        .order_by(similarity_score.desc(), IdeaBlock.id.desc())
        .limit(1)
    )
    row = result.one_or_none()
    if row is None:
        return None

    idea_block, similarity = row
    return idea_block, float(similarity)


def _normalize_dedup_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(
        char
        for char in normalized
        if not char.isspace() and not unicodedata.category(char).startswith("P")
    )
