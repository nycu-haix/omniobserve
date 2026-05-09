import time

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, contains_eager

from ..models import IdeaBlock, Similarity
from ..schemas import SimilarityCreate, SimilarityUpdate
from .realtime import board_manager


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


async def create_session_similarity(
    payload: SimilarityCreate,
    *,
    session_name: str,
    db: AsyncSession,
) -> Similarity:
    similarity, _ = await create_or_update_similarity_pair(
        payload.idea_block_id_1,
        payload.idea_block_id_2,
        payload.reason,
        session_name=session_name,
        user_id=None,
        db=db,
    )
    await _notify_similarity_cue(similarity)
    return similarity


async def get_similarity(similarity_id: int, db: AsyncSession) -> Similarity:
    similarity = await db.get(Similarity, similarity_id)
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


async def get_session_similarity(
    similarity_id: int,
    *,
    session_name: str,
    db: AsyncSession,
) -> Similarity:
    similarity = await _get_similarity_in_session(
        similarity_id,
        session_name=session_name,
        db=db,
    )
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
    similarity = await _get_similarity_in_session(
        similarity_id,
        session_name=session_name,
        db=db,
        user_id=user_id,
    )
    if similarity is None:
        raise HTTPException(status_code=404, detail="Similarity not found")
    return similarity


async def list_similarities(db: AsyncSession) -> list[Similarity]:
    idea_a = aliased(IdeaBlock)
    idea_b = aliased(IdeaBlock)
    result = await db.execute(
        select(Similarity)
        .join(Similarity.idea_block_1.of_type(idea_a))
        .join(Similarity.idea_block_2.of_type(idea_b))
        .options(
            contains_eager(Similarity.idea_block_1.of_type(idea_a)),
            contains_eager(Similarity.idea_block_2.of_type(idea_b)),
        )
        .where(
            idea_a.is_deleted.is_(False),
            idea_b.is_deleted.is_(False),
        )
        .order_by(Similarity.id.asc())
    )
    return list(result.scalars().all())


async def list_session_similarities(
    *,
    session_name: str,
    db: AsyncSession,
) -> list[Similarity]:
    return await _list_similarities_in_session(session_name=session_name, db=db)


async def list_scoped_similarities(
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> list[Similarity]:
    return await _list_similarities_in_session(session_name=session_name, db=db, user_id=user_id)


async def update_session_similarity(
    similarity_id: int,
    payload: SimilarityUpdate,
    *,
    session_name: str,
    db: AsyncSession,
) -> Similarity:
    similarity = await get_session_similarity(similarity_id, session_name=session_name, db=db)
    similarity.reason = _normalize_reason(payload.reason)
    await db.commit()
    return await get_session_similarity(similarity_id, session_name=session_name, db=db)


async def delete_session_similarity(
    similarity_id: int,
    *,
    session_name: str,
    db: AsyncSession,
) -> None:
    similarity = await get_session_similarity(similarity_id, session_name=session_name, db=db)
    idea_a = similarity.idea_block_1
    idea_b = similarity.idea_block_2
    await db.delete(similarity)
    await _clear_pair_similarity_ids(
        similarity.idea_block_id_1,
        similarity.idea_block_id_2,
        db,
    )
    await db.commit()
    await _notify_similarity_removed(idea_a, idea_b)


async def _get_similarity_in_session(
    similarity_id: int,
    *,
    session_name: str,
    db: AsyncSession,
    user_id: int | None = None,
) -> Similarity | None:
    stmt = _similarities_in_session_stmt(session_name=session_name, user_id=user_id).where(
        Similarity.id == similarity_id
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _list_similarities_in_session(
    *,
    session_name: str,
    db: AsyncSession,
    user_id: int | None = None,
) -> list[Similarity]:
    result = await db.execute(
        _similarities_in_session_stmt(session_name=session_name, user_id=user_id).order_by(Similarity.id.asc())
    )
    return list(result.scalars().all())


def _similarities_in_session_stmt(
    *,
    session_name: str,
    user_id: int | None = None,
):
    idea_a = aliased(IdeaBlock)
    idea_b = aliased(IdeaBlock)
    stmt = (
        select(Similarity)
        .join(Similarity.idea_block_1.of_type(idea_a))
        .join(Similarity.idea_block_2.of_type(idea_b))
        .options(
            contains_eager(Similarity.idea_block_1.of_type(idea_a)),
            contains_eager(Similarity.idea_block_2.of_type(idea_b)),
        )
        .where(
            idea_a.session_name == session_name,
            idea_b.session_name == session_name,
            idea_a.is_deleted.is_(False),
            idea_b.is_deleted.is_(False),
        )
    )
    if user_id is not None:
        stmt = stmt.where(or_(idea_a.user_id == user_id, idea_b.user_id == user_id))
    return stmt


async def create_or_update_similarity_pair(
    idea_block_id_1: int,
    idea_block_id_2: int,
    reason: str,
    *,
    session_name: str,
    user_id: int | None,
    db: AsyncSession,
) -> tuple[Similarity, str]:
    idea_a, idea_b = await _require_scoped_pair_idea_blocks(
        idea_block_id_1,
        idea_block_id_2,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    normalized_reason = _normalize_reason(reason)

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

    similarity.idea_block_1 = idea_a if similarity.idea_block_id_1 == idea_a.id else idea_b
    similarity.idea_block_2 = idea_b if similarity.idea_block_id_2 == idea_b.id else idea_a

    return similarity, action


async def _notify_similarity_cue(similarity: Similarity) -> None:
    idea_a = similarity.idea_block_1
    idea_b = similarity.idea_block_2
    if idea_a.session_name != idea_b.session_name:
        return

    await _send_similarity_cue(
        session_name=idea_a.session_name,
        participant_id=str(idea_a.user_id),
        own_block=idea_a,
        other_block=idea_b,
        similarity_id=similarity.id,
    )
    await _send_similarity_cue(
        session_name=idea_b.session_name,
        participant_id=str(idea_b.user_id),
        own_block=idea_b,
        other_block=idea_a,
        similarity_id=similarity.id,
    )


async def _send_similarity_cue(
    *,
    session_name: str,
    participant_id: str,
    own_block: IdeaBlock,
    other_block: IdeaBlock,
    similarity_id: int,
) -> None:
    await board_manager.send_to(
        session_name,
        participant_id,
        {
            "type": "update_idea_block",
            "payload": {"id": str(own_block.id)},
        },
    )
    await board_manager.send_to(
        session_name,
        participant_id,
        {
            "type": "similarity_cue",
            "payload": {
                "id": f"similarity-{similarity_id}-{own_block.id}-{int(time.time() * 1000)}",
                "blockId": str(own_block.id),
                "blockSummary": other_block.title or other_block.summary,
            },
        },
    )


async def _notify_similarity_removed(idea_a: IdeaBlock, idea_b: IdeaBlock) -> None:
    if idea_a.session_name != idea_b.session_name:
        return
    await _send_idea_block_refresh(idea_a)
    await _send_idea_block_refresh(idea_b)


async def _send_idea_block_refresh(idea_block: IdeaBlock) -> None:
    await board_manager.send_to(
        idea_block.session_name,
        str(idea_block.user_id),
        {
            "type": "update_idea_block",
            "payload": {"id": str(idea_block.id)},
        },
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
    user_id: int | None,
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
    if idea_a.is_deleted or idea_b.is_deleted:
        raise HTTPException(status_code=404, detail="Idea block not found")
    if user_id is not None and idea_a.user_id != user_id and idea_b.user_id != user_id:
        raise HTTPException(status_code=404, detail="Idea block not found")
    return idea_a, idea_b


async def _clear_pair_similarity_ids(
    idea_block_id_1: int,
    idea_block_id_2: int,
    db: AsyncSession,
) -> None:
    await db.execute(
        update(IdeaBlock)
        .where(
            or_(
                and_(IdeaBlock.id == idea_block_id_1, IdeaBlock.similarity_id == idea_block_id_2),
                and_(IdeaBlock.id == idea_block_id_2, IdeaBlock.similarity_id == idea_block_id_1),
            )
        )
        .values(similarity_id=None)
    )


def _normalize_reason(reason: str) -> str:
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise HTTPException(status_code=400, detail="Similarity reason is required")
    return normalized_reason


def _append_reason(existing: str, new_reason: str) -> str:
    new_reason = new_reason.strip()
    if not new_reason or new_reason in existing:
        return existing
    return f"{existing}\n\n{new_reason}"
