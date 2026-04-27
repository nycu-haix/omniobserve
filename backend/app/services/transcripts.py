from datetime import datetime
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import TranscriptSegment, Visibility
from ..schemas import StreamTranscript
from ..utils import utc_now


async def create_transcript_segment_record(
    db: AsyncSession,
    *,
    session_id: str,
    participant_id: str,
    visibility: Visibility,
    text: str,
    source_audio_id: str | None,
    started_at: datetime,
    ended_at: datetime,
) -> TranscriptSegment:
    transcript = TranscriptSegment(
        id=str(uuid4()),
        session_id=session_id,
        participant_id=participant_id,
        visibility=visibility,
        text=text,
        source_audio_id=source_audio_id,
        started_at=started_at,
        ended_at=ended_at,
        created_at=utc_now(),
    )
    db.add(transcript)
    await db.flush()
    return transcript


async def save_ws_transcript_segment(
    db: AsyncSession,
    *,
    session_id: str,
    participant_id: str,
    visibility: Visibility,
    transcript_text: str,
    started_at: datetime,
    ended_at: datetime,
) -> StreamTranscript | None:
    transcript = TranscriptSegment(
        id=str(uuid4()),
        session_id=session_id,
        participant_id=participant_id,
        visibility=visibility,
        text=transcript_text,
        source_audio_id=None,
        started_at=started_at,
        ended_at=ended_at,
        created_at=utc_now(),
    )

    try:
        db.add(transcript)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Failed to save transcript segment from stream: %s", exc)
        return None

    return StreamTranscript(segment_id=transcript.id, text=transcript.text)
