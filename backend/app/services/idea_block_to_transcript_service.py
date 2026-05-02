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


async def delete_idea_block_to_transcript(id: int, db: AsyncSession) -> None:
    mapping = await db.get(IdeaBlockToTranscript, id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Idea block to transcript mapping not found")
    await db.delete(mapping)
    await db.commit()
