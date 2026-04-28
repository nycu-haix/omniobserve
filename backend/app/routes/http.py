from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import MOCK_TRANSCRIPT_TEXT
from ..db import get_db
from ..schemas import ApiError, ErrorResponse, IdeaBlockGenerateRequest, IdeaBlockGenerateResponse
from ..services.idea_blocks import generate_and_save_idea_blocks
from ..utils import to_iso_z

router = APIRouter()

COMMON_ERROR_RESPONSES = {
    400: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    500: {"model": ErrorResponse},
}


def serialize_idea_block(block: Any) -> dict[str, Any]:
    return {
        "id": block.id,
        "session_id": block.session_id,
        "participant_id": block.participant_id,
        "visibility": block.visibility.value,
        "content": block.content,
        "summary": block.summary,
        "transcript": block.transcript,
        "source_transcript_ids": block.source_transcript_ids,
        "created_at": to_iso_z(block.created_at),
        "updated_at": to_iso_z(block.updated_at),
    }


@router.post(
    "/sessions/{session_id}/idea-blocks/generate",
    status_code=201,
    response_model=IdeaBlockGenerateResponse,
    responses=COMMON_ERROR_RESPONSES,
    summary="Generate Idea Blocks From Transcript",
    description=(
        "Core flow: transcript -> LLM prompt -> idea blocks. "
        "Set use_mock_transcript=true for local testing without frontend audio input."
    ),
)
async def generate_idea_blocks(
    session_id: str,
    payload: IdeaBlockGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockGenerateResponse:
    transcript_text = MOCK_TRANSCRIPT_TEXT if payload.use_mock_transcript else (payload.transcript_text or "")
    transcript_text = transcript_text.strip()
    if not transcript_text:
        raise ApiError(
            400,
            "INVALID_PAYLOAD",
            "transcript_text is required when use_mock_transcript is false",
            details={"field": "transcript_text"},
        )

    try:
        idea_blocks = await generate_and_save_idea_blocks(
            db,
            session_id=session_id,
            participant_id=payload.participant_id,
            visibility=payload.visibility,
            source_transcript_ids=[],
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
