from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Transcript
from ..schemas import TranscriptCreate


async def create_transcript(payload: TranscriptCreate, db: AsyncSession) -> Transcript:
    transcript = Transcript(**payload.model_dump())
    db.add(transcript)
    await db.commit()
    await db.refresh(transcript)
    return transcript


async def get_transcript(transcript_id: int, db: AsyncSession) -> Transcript:
    transcript = await db.get(Transcript, transcript_id)
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return transcript


async def get_scoped_transcript(
    transcript_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> Transcript:
    result = await db.execute(
        select(Transcript).where(
            Transcript.id == transcript_id,
            Transcript.session_name == session_name,
            Transcript.user_id == user_id,
        )
    )
    transcript = result.scalar_one_or_none()
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return transcript


async def list_transcripts_by_session(
    session_name: str,
    user_id: int | None,
    db: AsyncSession,
) -> list[Transcript]:
    stmt = select(Transcript).where(Transcript.session_name == session_name)
    if user_id is not None:
        stmt = stmt.where(Transcript.user_id == user_id)
    stmt = stmt.order_by(Transcript.time_stamp.asc(), Transcript.id.asc())
    result = await db.execute(stmt)
    return list(result.scalars().all())
