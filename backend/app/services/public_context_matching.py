from dataclasses import dataclass

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock, TaskItem
from .embedding_service import create_text_embedding
from .task_item_generation import build_task_item_ids_with_llm

PUBLIC_CONTEXT_SIMILARITY_THRESHOLD = 0.68
PUBLIC_CONTEXT_DISTANCE_THRESHOLD = 1 - PUBLIC_CONTEXT_SIMILARITY_THRESHOLD


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
        embedding_vector = await create_text_embedding(normalized_text)
    except Exception as exc:
        logger.warning(
            "public_context_match_embedding_failed session_name=%s task_item_ids=%s candidate_count=%s error_type=%s error=%s",
            session_name,
            task_item_ids,
            len(candidate_ids),
            exc.__class__.__name__,
            exc,
        )
        return await _build_task_item_matches(
            db,
            idea_block_ids=candidate_ids,
            task_item_ids=task_item_ids,
        )

    semantic_matches = await _find_semantic_matches(
        db,
        session_name=session_name,
        embedding_vector=embedding_vector,
        candidate_idea_block_ids=candidate_ids,
        task_item_ids=task_item_ids,
    )
    semantic_matches_by_id = {match.idea_block_id: match for match in semantic_matches}
    matches = await _build_task_item_matches(
        db,
        idea_block_ids=candidate_ids,
        task_item_ids=task_item_ids,
        semantic_matches_by_id=semantic_matches_by_id,
    )
    logger.info(
        "public_context_match_done session_name=%s task_item_ids=%s candidate_count=%s semantic_match_count=%s match_count=%s",
        session_name,
        task_item_ids,
        len(candidate_ids),
        len(semantic_matches),
        len(matches),
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


async def _build_task_item_matches(
    db: AsyncSession,
    *,
    idea_block_ids: list[int],
    task_item_ids: list[int],
    semantic_matches_by_id: dict[int, PublicContextMatch] | None = None,
) -> list[PublicContextMatch]:
    semantic_matches_by_id = semantic_matches_by_id or {}
    result = await db.execute(
        select(IdeaBlock)
        .where(
            IdeaBlock.id.in_(idea_block_ids),
            IdeaBlock.is_deleted.is_(False),
        )
        .order_by(IdeaBlock.id.desc())
    )
    matches: list[PublicContextMatch] = []
    for idea_block in result.scalars().all():
        semantic_match = semantic_matches_by_id.get(idea_block.id)
        if semantic_match is not None:
            matches.append(semantic_match)
            continue
        matches.append(
            PublicContextMatch(
                idea_block_id=idea_block.id,
                user_id=idea_block.user_id,
                score=None,
                reason="same task item",
                task_item_ids=task_item_ids,
            )
        )

    return sorted(
        matches,
        key=lambda match: (
            match.score is None,
            -(match.score or 0),
            -match.idea_block_id,
        ),
    )
