from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import AudioSegment, FileFormat, MicMode, TranscriptSegment, Visibility
from ..schemas import ApiError, IdeaBlockGenerateRequest, TranscriptCreateRequest
from ..services.asr import transcribe_audio
from ..services.idea_blocks import generate_and_save_idea_blocks
from ..services.storage import save_audio_to_local_storage
from ..services.transcripts import create_transcript_segment_record
from ..utils import parse_iso8601_utc, to_iso_z, utc_now

router = APIRouter()


def serialize_audio_segment(segment: AudioSegment) -> dict[str, Any]:
    return {
        "id": segment.id,
        "session_id": segment.session_id,
        "participant_id": segment.participant_id,
        "mic_mode": segment.mic_mode.value,
        "file_format": segment.file_format.value,
        "duration_ms": segment.duration_ms,
        "started_at": to_iso_z(segment.started_at),
        "ended_at": to_iso_z(segment.ended_at),
        "created_at": to_iso_z(segment.created_at),
    }


def serialize_transcript_segment(segment: TranscriptSegment) -> dict[str, Any]:
    return {
        "id": segment.id,
        "session_id": segment.session_id,
        "participant_id": segment.participant_id,
        "visibility": segment.visibility.value,
        "text": segment.text,
        "source_audio_id": segment.source_audio_id,
        "started_at": to_iso_z(segment.started_at),
        "ended_at": to_iso_z(segment.ended_at),
        "created_at": to_iso_z(segment.created_at),
    }


def serialize_idea_block(block: Any) -> dict[str, Any]:
    return {
        "id": block.id,
        "session_id": block.session_id,
        "participant_id": block.participant_id,
        "visibility": block.visibility.value,
        "content": block.content,
        "summary": block.summary,
        "bullet_points": [
            {
                "id": bullet.id,
                "idea_block_id": bullet.idea_block_id,
                "session_id": bullet.session_id,
                "participant_id": bullet.participant_id,
                "visibility": bullet.visibility.value,
                "text": bullet.text,
                "order_index": bullet.order_index,
                "created_at": to_iso_z(bullet.created_at),
            }
            for bullet in block.bullet_points
        ],
        "source_transcript_ids": block.source_transcript_ids,
        "tags": block.tags,
        "created_at": to_iso_z(block.created_at),
        "updated_at": to_iso_z(block.updated_at),
    }


@router.post("/sessions/{session_id}/audio-segments", status_code=201)
async def upload_audio_segment(
    session_id: str,
    participant_id: str = Form(...),
    mic_mode: MicMode = Form(...),
    file_format: FileFormat = Form(...),
    started_at: str = Form(...),
    ended_at: str = Form(...),
    audio: UploadFile = File(...),
    retry_of: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    started_dt = parse_iso8601_utc(started_at, "started_at")
    ended_dt = parse_iso8601_utc(ended_at, "ended_at")
    duration_ms = int((ended_dt - started_dt).total_seconds() * 1000)
    if duration_ms <= 0:
        raise ApiError(400, "INVALID_PAYLOAD", "ended_at must be greater than started_at")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise ApiError(400, "INVALID_PAYLOAD", "audio must not be empty")

    try:
        audio_segment = AudioSegment(
            id=str(uuid4()),
            session_id=session_id,
            participant_id=participant_id,
            mic_mode=mic_mode,
            file_format=file_format,
            duration_ms=duration_ms,
            started_at=started_dt,
            ended_at=ended_dt,
            retry_of=retry_of,
            storage_path="",
            created_at=utc_now(),
        )
        db.add(audio_segment)
        await db.flush()

        audio_segment.storage_path = await save_audio_to_local_storage(
            session_id=session_id,
            audio_segment_id=audio_segment.id,
            file_format=file_format,
            audio_bytes=audio_bytes,
        )

        transcript_text = await transcribe_audio(audio_bytes)

        transcript_segment = await create_transcript_segment_record(
            db,
            session_id=session_id,
            participant_id=participant_id,
            visibility=Visibility(mic_mode.value),
            text=transcript_text,
            source_audio_id=audio_segment.id,
            started_at=started_dt,
            ended_at=ended_dt,
        )

        await generate_and_save_idea_blocks(
            db,
            session_id=session_id,
            participant_id=participant_id,
            visibility=Visibility(mic_mode.value),
            source_transcript_ids=[transcript_segment.id],
            transcript_text=transcript_text,
        )

        await db.commit()
    except ApiError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error") from exc

    return serialize_audio_segment(audio_segment)


@router.post("/sessions/{session_id}/transcript-segments", status_code=201)
async def create_transcript_segment(
    session_id: str,
    payload: TranscriptCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    started_dt = parse_iso8601_utc(payload.started_at, "started_at")
    ended_dt = parse_iso8601_utc(payload.ended_at, "ended_at")
    if ended_dt <= started_dt:
        raise ApiError(400, "INVALID_PAYLOAD", "ended_at must be greater than started_at")

    try:
        transcript = await create_transcript_segment_record(
            db,
            session_id=session_id,
            participant_id=payload.participant_id,
            visibility=payload.visibility,
            text=payload.text,
            source_audio_id=payload.source_audio_id,
            started_at=started_dt,
            ended_at=ended_dt,
        )
        await db.commit()
    except ApiError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error") from exc

    return serialize_transcript_segment(transcript)


@router.post("/sessions/{session_id}/idea-blocks/generate", status_code=201)
async def generate_idea_blocks(
    session_id: str,
    payload: IdeaBlockGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    transcripts_result = await db.execute(
        select(TranscriptSegment)
        .where(
            TranscriptSegment.session_id == session_id,
            TranscriptSegment.id.in_(payload.source_transcript_ids),
        )
        .order_by(TranscriptSegment.started_at.asc())
    )
    transcripts = list(transcripts_result.scalars().all())

    if not transcripts:
        raise ApiError(400, "TRANSCRIPT_NOT_FOUND", "No transcript segments found for source_transcript_ids")

    transcript_text = "\n".join(item.text for item in transcripts if item.text.strip()).strip()
    if not transcript_text:
        raise ApiError(400, "INVALID_PAYLOAD", "Transcript text is empty")

    try:
        idea_blocks = await generate_and_save_idea_blocks(
            db,
            session_id=session_id,
            participant_id=payload.participant_id,
            visibility=payload.visibility,
            source_transcript_ids=payload.source_transcript_ids,
            transcript_text=transcript_text,
        )
        await db.commit()
    except ApiError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error") from exc

    return {"idea_blocks": [serialize_idea_block(item) for item in idea_blocks]}
