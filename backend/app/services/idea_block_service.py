from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import IdeaBlock, IdeaBlockToTranscript, Similarity, TaskItem, Transcript
from ..schemas import IdeaBlockCreate, IdeaBlockUpdate
from .embedding_service import create_text_embedding


async def create_idea_block(payload: IdeaBlockCreate, db: AsyncSession) -> IdeaBlock:
    if payload.transcript_id is not None and await db.get(Transcript, payload.transcript_id) is None:
        raise HTTPException(status_code=404, detail="Transcript not found")

    idea_block_data = payload.model_dump()
    idea_block_data["embedding_vector"] = await create_text_embedding(payload.summary)
    idea_block = IdeaBlock(**idea_block_data, similarity_id=None)
    db.add(idea_block)
    await db.commit()
    return await get_idea_block(idea_block.id, db)


async def get_idea_block(idea_block_id: int, db: AsyncSession) -> IdeaBlock:
    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.main_transcript))
        .where(IdeaBlock.id == idea_block_id)
    )
    idea_block = result.scalar_one_or_none()
    if idea_block is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    return idea_block


async def get_scoped_idea_block(
    idea_block_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> IdeaBlock:
    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.main_transcript))
        .where(
            IdeaBlock.id == idea_block_id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
    )
    idea_block = result.scalar_one_or_none()
    if idea_block is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    return idea_block


async def list_idea_blocks(
    db: AsyncSession,
    *,
    user_id: int | None = None,
    session_name: str | None = None,
    similarity_id: UUID | None = None,
) -> list[IdeaBlock]:
    stmt = select(IdeaBlock).options(selectinload(IdeaBlock.main_transcript))
    if user_id is not None:
        stmt = stmt.where(IdeaBlock.user_id == user_id)
    if session_name is not None:
        stmt = stmt.where(IdeaBlock.session_name == session_name)
    if similarity_id is not None:
        stmt = stmt.where(IdeaBlock.similarity_id == similarity_id)
    stmt = stmt.order_by(IdeaBlock.time_stamp.asc(), IdeaBlock.id.asc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_idea_block(
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    db: AsyncSession,
) -> IdeaBlock:
    idea_block = await get_idea_block(idea_block_id, db)
    update_data = payload.model_dump(exclude_unset=True)
    if "similarity_id" in update_data and update_data["similarity_id"] is not None:
        if await db.get(Similarity, update_data["similarity_id"]) is None:
            raise HTTPException(status_code=404, detail="Similarity not found")

    if "transcript" in update_data:
        transcript_text = update_data.pop("transcript")
        transcript_value = "" if transcript_text is None else str(transcript_text).strip()
        if idea_block.main_transcript is None:
            transcript = Transcript(
                user_id=idea_block.user_id,
                session_name=idea_block.session_name,
                transcript=transcript_value,
            )
            db.add(transcript)
            await db.flush()
            idea_block.transcript_id = transcript.id
            idea_block.main_transcript = transcript
        else:
            idea_block.main_transcript.transcript = transcript_value

    for field, value in update_data.items():
        setattr(idea_block, field, value)

    await db.commit()
    return await get_idea_block(idea_block_id, db)


async def update_scoped_idea_block(
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> IdeaBlock:
    idea_block = await get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    update_data = payload.model_dump(exclude_unset=True)
    if "similarity_id" in update_data and update_data["similarity_id"] is not None:
        if await db.get(Similarity, update_data["similarity_id"]) is None:
            raise HTTPException(status_code=404, detail="Similarity not found")

    if "transcript" in update_data:
        transcript_text = update_data.pop("transcript")
        transcript_value = "" if transcript_text is None else str(transcript_text).strip()
        if idea_block.main_transcript is None:
            transcript = Transcript(
                user_id=idea_block.user_id,
                session_name=idea_block.session_name,
                transcript=transcript_value,
            )
            db.add(transcript)
            await db.flush()
            idea_block.transcript_id = transcript.id
            idea_block.main_transcript = transcript
        else:
            idea_block.main_transcript.transcript = transcript_value

    for field, value in update_data.items():
        setattr(idea_block, field, value)

    await db.commit()
    return await get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )


async def delete_idea_block(idea_block_id: int, db: AsyncSession) -> None:
    idea_block = await get_idea_block(idea_block_id, db)
    await db.execute(delete(TaskItem).where(TaskItem.idea_block_id == idea_block_id))
    await db.execute(delete(IdeaBlockToTranscript).where(IdeaBlockToTranscript.idea_blocks_id == idea_block_id))
    await db.delete(idea_block)
    await db.commit()


async def delete_scoped_idea_block(
    idea_block_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    idea_block = await get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    await db.execute(delete(TaskItem).where(TaskItem.idea_block_id == idea_block_id))
    await db.execute(delete(IdeaBlockToTranscript).where(IdeaBlockToTranscript.idea_blocks_id == idea_block_id))
    await db.delete(idea_block)
    await db.commit()
