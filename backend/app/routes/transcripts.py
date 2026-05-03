from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import TranscriptCreate, TranscriptCreateRequest, TranscriptResponse
from ..services.transcript_service import (
    create_transcript,
    get_scoped_transcript,
    list_transcripts,
    list_transcripts_by_session,
)

router = APIRouter(tags=["Transcripts"])


@router.get(
    "/transcripts",
    response_model=list[TranscriptResponse],
    summary="List All Transcripts",
)
async def read_all_transcripts(
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptResponse]:
    return await list_transcripts(db)


@router.get(
    "/sessions/{session_name}/transcripts",
    response_model=list[TranscriptResponse],
    summary="List Transcripts For Session",
)
async def read_all_session_transcripts(
    session_name: str,
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptResponse]:
    return await list_transcripts(db, session_name=session_name)


@router.post(
    "/sessions/{session_name}/users/{user_id}/transcripts",
    status_code=status.HTTP_201_CREATED,
    response_model=TranscriptResponse,
    summary="Create Transcript",
)
async def post_transcript(
    session_name: str,
    user_id: int,
    payload: TranscriptCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    scoped_payload = TranscriptCreate(
        session_name=session_name,
        user_id=user_id,
        transcript=payload.transcript,
    )
    return await create_transcript(scoped_payload, db)


@router.get(
    "/sessions/{session_name}/users/{user_id}/transcripts/{transcript_id}",
    response_model=TranscriptResponse,
    summary="Get Transcript By ID",
)
async def read_transcript(
    session_name: str,
    user_id: int,
    transcript_id: int,
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    return await get_scoped_transcript(transcript_id, session_name=session_name, user_id=user_id, db=db)


@router.get(
    "/sessions/{session_name}/users/{user_id}/transcripts",
    response_model=list[TranscriptResponse],
    summary="List Transcripts By Session Name",
)
async def read_session_transcripts(
    session_name: str,
    user_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptResponse]:
    return await list_transcripts_by_session(session_name, user_id, db)
