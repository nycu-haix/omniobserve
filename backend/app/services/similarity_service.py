from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdeaBlock, Similarity
from ..schemas import SimilarityAssignResponse, SimilarityCreate


async def create_similarity(payload: SimilarityCreate, db: AsyncSession) -> Similarity:
    similarity = Similarity(similarity_reason=payload.similarity_reason)
    db.add(similarity)
    await db.commit()
    await db.refresh(similarity)
    return similarity


async def get_similarity(similarity_id: UUID, db: AsyncSession) -> Similarity:
    similarity = await db.get(Similarity, similarity_id)
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


async def get_scoped_similarity(
    similarity_id: UUID,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> Similarity:
    result = await db.execute(
        select(Similarity)
        .join(IdeaBlock, IdeaBlock.similarity_id == Similarity.id)
        .where(
            Similarity.id == similarity_id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
    )
    similarity = result.scalar_one_or_none()
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


async def list_similarities(db: AsyncSession) -> list[Similarity]:
    result = await db.execute(select(Similarity))
    return list(result.scalars().all())


async def list_scoped_similarities(
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> list[Similarity]:
    result = await db.execute(
        select(Similarity)
        .join(IdeaBlock, IdeaBlock.similarity_id == Similarity.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
        .order_by(Similarity.id.asc())
    )
    return list(result.scalars().unique().all())


async def assign_similarity_to_idea_blocks(
    idea_block_a_id: int,
    idea_block_b_id: int,
    similarity_reason: str,
    db: AsyncSession,
) -> SimilarityAssignResponse:
    idea_a = await db.get(IdeaBlock, idea_block_a_id)
    idea_b = await db.get(IdeaBlock, idea_block_b_id)
    if idea_a is None or idea_b is None:
        raise HTTPException(status_code=404, detail="Idea block not found")

    a_similarity_id = idea_a.similarity_id
    b_similarity_id = idea_b.similarity_id

    if a_similarity_id is None and b_similarity_id is None:
        similarity = Similarity(similarity_reason=similarity_reason)
        db.add(similarity)
        await db.flush()
        idea_a.similarity_id = similarity.id
        idea_b.similarity_id = similarity.id
        action = "created"

    elif a_similarity_id is not None and b_similarity_id is None:
        similarity = await _require_similarity(a_similarity_id, db)
        idea_b.similarity_id = a_similarity_id
        action = "assigned_b_to_a"

    elif a_similarity_id is None and b_similarity_id is not None:
        similarity = await _require_similarity(b_similarity_id, db)
        idea_a.similarity_id = b_similarity_id
        action = "assigned_a_to_b"

    elif a_similarity_id == b_similarity_id:
        similarity = await _require_similarity(a_similarity_id, db)
        action = "already_same_cluster"

    else:
        target_similarity_id = a_similarity_id
        old_similarity_id = b_similarity_id
        similarity = await _require_similarity(target_similarity_id, db)
        await _require_similarity(old_similarity_id, db)

        await db.execute(
            update(IdeaBlock)
            .where(IdeaBlock.similarity_id == old_similarity_id)
            .values(similarity_id=target_similarity_id)
        )
        similarity.similarity_reason = _append_reason(similarity.similarity_reason, similarity_reason)
        await db.execute(delete(Similarity).where(Similarity.id == old_similarity_id))
        action = "merged_clusters"

    await db.commit()
    await db.refresh(idea_a)
    await db.refresh(idea_b)
    await db.refresh(similarity)

    return SimilarityAssignResponse(
        similarity_id=similarity.id,
        idea_block_a_id=idea_block_a_id,
        idea_block_b_id=idea_block_b_id,
        similarity_reason=similarity.similarity_reason,
        action=action,
    )


async def assign_scoped_similarity_to_idea_blocks(
    idea_block_a_id: int,
    idea_block_b_id: int,
    similarity_reason: str,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> SimilarityAssignResponse:
    await _require_scoped_idea_block(idea_block_a_id, session_name=session_name, user_id=user_id, db=db)
    await _require_scoped_idea_block(idea_block_b_id, session_name=session_name, user_id=user_id, db=db)
    return await assign_similarity_to_idea_blocks(
        idea_block_a_id,
        idea_block_b_id,
        similarity_reason,
        db,
    )


async def _require_similarity(similarity_id: UUID | None, db: AsyncSession) -> Similarity:
    if similarity_id is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    similarity = await db.get(Similarity, similarity_id)
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


def _append_reason(existing: str, new_reason: str) -> str:
    new_reason = new_reason.strip()
    if not new_reason or new_reason in existing:
        return existing
    return f"{existing}\n\n{new_reason}"


async def _require_scoped_idea_block(
    idea_block_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    result = await db.execute(
        select(IdeaBlock.id).where(
            IdeaBlock.id == idea_block_id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
