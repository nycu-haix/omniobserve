from datetime import datetime

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import Transcript, Visibility
from ..schemas import StreamTranscript


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
    transcript = Transcript(
        user_id=_numeric_id(participant_id),
        session_id=_numeric_id(session_id),
        transcript=transcript_text,
    )

    try:
        db.add(transcript)
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Failed to save transcript segment from stream: %s", exc)
        return None

    return StreamTranscript(segment_id=str(transcript.id), text=transcript.transcript)


def _numeric_id(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
