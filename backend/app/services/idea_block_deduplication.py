from dataclasses import dataclass

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock, TaskItem

DEDUPLICATION_SIMILARITY_THRESHOLD = 0.85
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
    embedding_vector: list[float] | None,
    task_item_ids: list[int],
) -> DuplicateIdeaBlockMatch | None:
    normalized_task_item_ids = _normalize_task_item_ids(task_item_ids)
    if embedding_vector is None or not normalized_task_item_ids:
        return None

    same_item_block_ids = await _find_same_task_item_block_ids(
        db,
        session_name=session_name,
        user_id=user_id,
        task_item_ids=normalized_task_item_ids,
    )
    if not same_item_block_ids:
        return None

    semantic_match = await _find_semantic_match(
        db,
        session_name=session_name,
        user_id=user_id,
        embedding_vector=embedding_vector,
        candidate_idea_block_ids=same_item_block_ids,
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
        reason="shared task item semantic similarity",
        similarity=similarity,
    )


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


async def _find_semantic_match(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    embedding_vector: list[float],
    candidate_idea_block_ids: list[int],
) -> tuple[IdeaBlock, float] | None:
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


def _normalize_task_item_ids(task_item_ids: list[int]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for task_item_id in task_item_ids:
        if not isinstance(task_item_id, int) or task_item_id in seen:
            continue
        seen.add(task_item_id)
        normalized.append(task_item_id)
    return normalized
