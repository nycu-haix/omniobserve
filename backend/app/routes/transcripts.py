from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import TranscriptCreate, TranscriptResponse
from ..services.transcript_service import create_transcript, get_transcript, list_transcripts_by_session

router = APIRouter(tags=["Transcripts"])


@router.post(
    "/transcripts",
    status_code=status.HTTP_201_CREATED,
    response_model=TranscriptResponse,
    summary="Create Transcript",
)
async def post_transcript(
    payload: TranscriptCreate,
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    return await create_transcript(payload, db)


@router.get(
    "/transcripts/{transcript_id}",
    response_model=TranscriptResponse,
    summary="Get Transcript By ID",
)
async def read_transcript(
    transcript_id: int,
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    return await get_transcript(transcript_id, db)


@router.get(
    "/sessions/{session_name}/transcripts",
    response_model=list[TranscriptResponse],
    summary="List Transcripts By Session Name",
)
async def read_session_transcripts(
    session_name: str,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptResponse]:
    return await list_transcripts_by_session(session_name, user_id, db)
