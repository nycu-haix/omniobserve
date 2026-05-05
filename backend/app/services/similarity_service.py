from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..models import IdeaBlock, Similarity
from ..schemas import SimilarityAssignResponse, SimilarityCreate


async def create_similarity(
    payload: SimilarityCreate,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> Similarity:
    similarity, _ = await create_or_update_similarity_pair(
        payload.idea_block_id_1,
        payload.idea_block_id_2,
        payload.reason,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    return similarity


async def get_similarity(similarity_id: int, db: AsyncSession) -> Similarity:
    similarity = await db.get(Similarity, similarity_id)
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


async def get_scoped_similarity(
    similarity_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> Similarity:
    idea_a = aliased(IdeaBlock)
    idea_b = aliased(IdeaBlock)
    result = await db.execute(
        select(Similarity)
        .join(idea_a, Similarity.idea_block_id_1 == idea_a.id)
        .join(idea_b, Similarity.idea_block_id_2 == idea_b.id)
        .where(
            Similarity.id == similarity_id,
            idea_a.session_name == session_name,
            idea_b.session_name == session_name,
            or_(idea_a.user_id == user_id, idea_b.user_id == user_id),
        )
    )
    similarity = result.scalar_one_or_none()
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


async def list_similarities(db: AsyncSession) -> list[Similarity]:
    result = await db.execute(select(Similarity).order_by(Similarity.id.asc()))
    return list(result.scalars().all())


async def list_scoped_similarities(
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> list[Similarity]:
    idea_a = aliased(IdeaBlock)
    idea_b = aliased(IdeaBlock)
    result = await db.execute(
        select(Similarity)
        .join(idea_a, Similarity.idea_block_id_1 == idea_a.id)
        .join(idea_b, Similarity.idea_block_id_2 == idea_b.id)
        .where(
            idea_a.session_name == session_name,
            idea_b.session_name == session_name,
            or_(idea_a.user_id == user_id, idea_b.user_id == user_id),
        )
        .order_by(Similarity.id.asc())
    )
    return list(result.scalars().all())


async def create_or_update_similarity_pair(
    idea_block_id_1: int,
    idea_block_id_2: int,
    reason: str,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> tuple[Similarity, str]:
    idea_a, idea_b = await _require_scoped_pair_idea_blocks(
        idea_block_id_1,
        idea_block_id_2,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise HTTPException(status_code=400, detail="Similarity reason is required")

    existing = await _find_similarity_pair(idea_a.id, idea_b.id, db)
    if existing is None:
        similarity = Similarity(
            idea_block_id_1=idea_a.id,
            idea_block_id_2=idea_b.id,
            reason=normalized_reason,
        )
        db.add(similarity)
        action = "created"
    else:
        similarity = existing
        similarity.reason = _append_reason(similarity.reason, normalized_reason)
        action = "updated_existing_pair"

    if idea_a.similarity_id is None:
        idea_a.similarity_id = idea_b.id
    if idea_b.similarity_id is None:
        idea_b.similarity_id = idea_a.id

    await db.commit()
    await db.refresh(similarity)
    await db.refresh(idea_a)
    await db.refresh(idea_b)
    return similarity, action


async def assign_similarity_to_idea_blocks(
    idea_block_a_id: int,
    idea_block_b_id: int,
    reason: str,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> SimilarityAssignResponse:
    similarity, action = await create_or_update_similarity_pair(
        idea_block_a_id,
        idea_block_b_id,
        reason,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    return SimilarityAssignResponse(
        id=similarity.id,
        idea_block_id_1=similarity.idea_block_id_1,
        idea_block_id_2=similarity.idea_block_id_2,
        idea_block_a_id=idea_block_a_id,
        idea_block_b_id=idea_block_b_id,
        reason=similarity.reason,
        action=action,
    )


async def assign_scoped_similarity_to_idea_blocks(
    idea_block_a_id: int,
    idea_block_b_id: int,
    reason: str,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> SimilarityAssignResponse:
    return await assign_similarity_to_idea_blocks(
        idea_block_a_id,
        idea_block_b_id,
        reason,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )


async def _find_similarity_pair(
    idea_block_id_1: int,
    idea_block_id_2: int,
    db: AsyncSession,
) -> Similarity | None:
    result = await db.execute(
        select(Similarity).where(
            or_(
                and_(
                    Similarity.idea_block_id_1 == idea_block_id_1,
                    Similarity.idea_block_id_2 == idea_block_id_2,
                ),
                and_(
                    Similarity.idea_block_id_1 == idea_block_id_2,
                    Similarity.idea_block_id_2 == idea_block_id_1,
                ),
            )
        )
    )
    return result.scalar_one_or_none()


async def _require_scoped_pair_idea_blocks(
    idea_block_id_1: int,
    idea_block_id_2: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> tuple[IdeaBlock, IdeaBlock]:
    if idea_block_id_1 == idea_block_id_2:
        raise HTTPException(status_code=400, detail="Similarity requires two different idea blocks")

    result = await db.execute(
        select(IdeaBlock).where(IdeaBlock.id.in_([idea_block_id_1, idea_block_id_2]))
    )
    ideas = {idea.id: idea for idea in result.scalars().all()}
    idea_a = ideas.get(idea_block_id_1)
    idea_b = ideas.get(idea_block_id_2)
    if idea_a is None or idea_b is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    if idea_a.session_name != session_name or idea_b.session_name != session_name:
        raise HTTPException(status_code=404, detail="Idea block not found")
    if idea_a.user_id != user_id and idea_b.user_id != user_id:
        raise HTTPException(status_code=404, detail="Idea block not found")
    return idea_a, idea_b


def _append_reason(existing: str, new_reason: str) -> str:
    new_reason = new_reason.strip()
    if not new_reason or new_reason in existing:
        return existing
    return f"{existing}\n\n{new_reason}"
