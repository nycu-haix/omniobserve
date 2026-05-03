from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdeaBlock, IdeaBlockToTranscript, Transcript
from ..schemas import IdeaBlockToTranscriptCreate


async def create_idea_block_to_transcript(
    payload: IdeaBlockToTranscriptCreate,
    db: AsyncSession,
) -> IdeaBlockToTranscript:
    if await db.get(IdeaBlock, payload.idea_blocks_id) is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    if await db.get(Transcript, payload.transcript_id) is None:
        raise HTTPException(status_code=404, detail="Transcript not found")

    mapping = IdeaBlockToTranscript(**payload.model_dump())
    db.add(mapping)
    await db.commit()
    await db.refresh(mapping)
    return mapping


async def create_scoped_idea_block_to_transcript(
    payload: IdeaBlockToTranscriptCreate,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> IdeaBlockToTranscript:
    await _require_scoped_idea_block(payload.idea_blocks_id, session_name=session_name, user_id=user_id, db=db)
    await _require_scoped_transcript(payload.transcript_id, session_name=session_name, user_id=user_id, db=db)
    return await create_idea_block_to_transcript(payload, db)


async def list_idea_block_to_transcripts(
    db: AsyncSession,
    *,
    idea_blocks_id: int | None = None,
    transcript_id: int | None = None,
) -> list[IdeaBlockToTranscript]:
    stmt = select(IdeaBlockToTranscript)
    if idea_blocks_id is not None:
        stmt = stmt.where(IdeaBlockToTranscript.idea_blocks_id == idea_blocks_id)
    if transcript_id is not None:
        stmt = stmt.where(IdeaBlockToTranscript.transcript_id == transcript_id)
    result = await db.execute(stmt.order_by(IdeaBlockToTranscript.id.asc()))
    return list(result.scalars().all())


async def list_scoped_idea_block_to_transcripts(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    idea_blocks_id: int | None = None,
    transcript_id: int | None = None,
) -> list[IdeaBlockToTranscript]:
    stmt = (
        select(IdeaBlockToTranscript)
        .join(IdeaBlock, IdeaBlockToTranscript.idea_blocks_id == IdeaBlock.id)
        .join(Transcript, IdeaBlockToTranscript.transcript_id == Transcript.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            Transcript.session_name == session_name,
            Transcript.user_id == user_id,
        )
    )
    if idea_blocks_id is not None:
        stmt = stmt.where(IdeaBlockToTranscript.idea_blocks_id == idea_blocks_id)
    if transcript_id is not None:
        stmt = stmt.where(IdeaBlockToTranscript.transcript_id == transcript_id)
    result = await db.execute(stmt.order_by(IdeaBlockToTranscript.id.asc()))
    return list(result.scalars().all())


async def delete_idea_block_to_transcript(id: int, db: AsyncSession) -> None:
    mapping = await db.get(IdeaBlockToTranscript, id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Idea block to transcript mapping not found")
    await db.delete(mapping)
    await db.commit()


async def delete_scoped_idea_block_to_transcript(
    id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    result = await db.execute(
        select(IdeaBlockToTranscript)
        .join(IdeaBlock, IdeaBlockToTranscript.idea_blocks_id == IdeaBlock.id)
        .join(Transcript, IdeaBlockToTranscript.transcript_id == Transcript.id)
        .where(
            IdeaBlockToTranscript.id == id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
            Transcript.session_name == session_name,
            Transcript.user_id == user_id,
        )
    )
    mapping = result.scalar_one_or_none()
    if mapping is None:
        raise HTTPException(status_code=404, detail="Idea block to transcript mapping not found")
    await db.delete(mapping)
    await db.commit()


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


async def _require_scoped_transcript(
    transcript_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    result = await db.execute(
        select(Transcript.id).where(
            Transcript.id == transcript_id,
            Transcript.session_name == session_name,
            Transcript.user_id == user_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Transcript not found")
