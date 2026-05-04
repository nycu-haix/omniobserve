from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import FRONTEND_MOCK_TRANSCRIPT_LINES, FRONTEND_MOCK_TRANSCRIPT_TEXT, MOCK_TRANSCRIPT_TEXT, TOPIC_DESCRIPTION
from ..db import get_db
from ..schemas import (
    ApiError,
    ErrorResponse,
    FrontendBoardBlockCreateRequest,
    FrontendBoardBlockCreateResponse,
    FrontendMockBoardSeedRequest,
    FrontendMockBoardSeedResponse,
    IdeaBlockGenerateRequest,
    IdeaBlockGenerateResponse,
    IdeaBlockUpdateRequest,
    IdeaBlockUpdateResponse,
    TopicDescriptionResponse,
)
from ..services.board_payloads import (
    serialize_frontend_board_idea_block,
    serialize_frontend_board_idea_block_update,
)
from ..services.idea_blocks import generate_and_save_idea_blocks, update_idea_block_fields
from ..services.realtime import board_manager, presence_manager
from ..services.transcript_pipeline import generate_idea_blocks_with_task_items_from_text
from ..utils import to_iso_z

router = APIRouter()

COMMON_ERROR_RESPONSES = {
    400: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    500: {"model": ErrorResponse},
}


@router.get(
    "/api/topic-description",
    response_model=TopicDescriptionResponse,
    summary="Get Topic Description",
    description="Returns only the ranking task topic description for frontend display.",
)
async def get_topic_description() -> TopicDescriptionResponse:
    return TopicDescriptionResponse(topic_description=TOPIC_DESCRIPTION)


def serialize_idea_block(block: Any) -> dict[str, Any]:
    return {
        "id": block.id,
        "session_name": block.session_name,
        "participant_id": block.participant_id,
        "visibility": block.visibility.value,
        "content": block.content,
        "summary": block.summary,
        "transcript": block.transcript,
        "source_transcript_ids": block.source_transcript_ids,
        "created_at": to_iso_z(block.created_at),
        "updated_at": to_iso_z(block.updated_at),
    }


def build_transcript_lines_for_frontend(transcript_text: str) -> list[str]:
    lines = [line.strip() for line in transcript_text.splitlines() if line.strip()]
    return lines or [transcript_text.strip()]


def resolve_payload_session_name(payload: Any) -> str:
    session_name = (
        getattr(payload, "sessionName", None)
        or getattr(payload, "sessionId", None)
        or getattr(payload, "roomId", None)
        or ""
    ).strip()
    if not session_name:
        raise ApiError(400, "INVALID_PAYLOAD", "sessionName is required", details={"field": "sessionName"})
    return session_name


@router.post(
    "/sessions/{session_name}/users/{user_id}/idea-blocks/generate",
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
    session_name: str,
    user_id: int,
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
        pipeline_result = await generate_idea_blocks_with_task_items_from_text(
            db,
            session_name=session_name,
            user_id=user_id,
            visibility=payload.visibility,
            transcript_text=transcript_text,
        )
        idea_blocks = pipeline_result.idea_blocks
    except ApiError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error") from exc

    return {"idea_blocks": [serialize_idea_block(item) for item in idea_blocks]}


@router.post(
    "/api/board/block",
    status_code=201,
    response_model=FrontendBoardBlockCreateResponse,
    responses=COMMON_ERROR_RESPONSES,
    summary="Generate Idea Blocks For Frontend Board",
    description=(
        "Frontend-compatible endpoint. Uses transcript_text if provided, otherwise can use "
        "the frontend mock transcript and broadcasts `new_idea_block` board messages."
    ),
)
async def create_frontend_board_block(
    payload: FrontendBoardBlockCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> FrontendBoardBlockCreateResponse:
    session_name = resolve_payload_session_name(payload)

    transcript_text = (payload.transcript_text or "").strip()
    using_frontend_mock_transcript = False
    if not transcript_text and payload.use_mock_transcript:
        transcript_text = FRONTEND_MOCK_TRANSCRIPT_TEXT
        using_frontend_mock_transcript = True
    if not transcript_text:
        raise ApiError(
            400,
            "INVALID_PAYLOAD",
            "transcript_text is required when use_mock_transcript is false",
            details={"field": "transcript_text"},
        )

    participant_id = (payload.participantId or "1").strip() or "1"

    try:
        idea_blocks = await generate_and_save_idea_blocks(
            db,
            session_name=session_name,
            participant_id=participant_id,
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

    if using_frontend_mock_transcript:
        for index, line in enumerate(FRONTEND_MOCK_TRANSCRIPT_LINES, start=1):
            await board_manager.broadcast(
                session_name,
                {
                    "type": "new_transcript_line",
                    "payload": {"id": f"mock-t{index}", "text": line},
                },
            )
    elif payload.transcript_text and payload.transcript_text.strip():
        transcript_event_id = str(uuid4())
        for index, line in enumerate(build_transcript_lines_for_frontend(transcript_text), start=1):
            await board_manager.broadcast(
                session_name,
                {
                    "type": "new_transcript_line",
                    "payload": {"id": f"manual-{transcript_event_id}-t{index}", "text": line},
                },
            )

    for block in idea_blocks:
        await board_manager.broadcast(
            session_name,
            {
                "type": "new_idea_block",
                "payload": serialize_frontend_board_idea_block(block),
            },
        )

    return {"accepted": True, "generated_count": len(idea_blocks)}


@router.get(
    "/api/sessions/{session_name}/presence",
    summary="Get Session Presence",
    description="Returns the participant ids currently connected to the session presence channel.",
)
async def get_session_presence(session_name: str) -> dict[str, Any]:
    participants = sorted(
        {
            *presence_manager.get_participants(session_name),
            *board_manager.get_participants(session_name),
        }
    )

    return {
        "session_name": session_name,
        "participants": participants,
    }


@router.post(
    "/api/board/mock-seed",
    status_code=201,
    response_model=FrontendMockBoardSeedResponse,
    responses=COMMON_ERROR_RESPONSES,
    summary="Seed Board With Frontend Mock Transcript",
    description=(
        "Testing endpoint: broadcasts transcript lines from FRONTEND_MOCK_TRANSCRIPT_LINES, "
        "then generates and broadcasts idea blocks."
    ),
)
async def seed_frontend_board_with_mock_transcript(
    payload: FrontendMockBoardSeedRequest,
    db: AsyncSession = Depends(get_db),
) -> FrontendMockBoardSeedResponse:
    session_name = resolve_payload_session_name(payload)

    participant_id = (payload.participantId or "1").strip() or "1"

    for index, line in enumerate(FRONTEND_MOCK_TRANSCRIPT_LINES, start=1):
        await board_manager.broadcast(
            session_name,
            {
                "type": "new_transcript_line",
                "payload": {"id": f"mock-t{index}", "text": line},
            },
        )

    try:
        idea_blocks = await generate_and_save_idea_blocks(
            db,
            session_name=session_name,
            participant_id=participant_id,
            visibility=payload.visibility,
            source_transcript_ids=[],
            transcript_text=FRONTEND_MOCK_TRANSCRIPT_TEXT,
        )
        await db.commit()
    except ApiError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error") from exc

    for block in idea_blocks:
        await board_manager.broadcast(
            session_name,
            {
                "type": "new_idea_block",
                "payload": serialize_frontend_board_idea_block(block),
            },
        )

    return {
        "accepted": True,
        "transcript_count": len(FRONTEND_MOCK_TRANSCRIPT_LINES),
        "generated_count": len(idea_blocks),
    }


@router.patch(
    "/api/board/idea-blocks/{block_id}",
    response_model=IdeaBlockUpdateResponse,
    responses=COMMON_ERROR_RESPONSES,
    summary="Update Generated Idea Block",
    description="Update editable fields of a generated idea block and broadcast `update_idea_block`.",
)
async def update_frontend_board_idea_block(
    block_id: str,
    payload: IdeaBlockUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockUpdateResponse:
    update_fields: dict[str, Any] = {}
    if "summary" in payload.model_fields_set:
        update_fields["content"] = payload.summary
    if "aiSummary" in payload.model_fields_set:
        update_fields["summary"] = payload.aiSummary
    if "transcript" in payload.model_fields_set:
        update_fields["transcript"] = payload.transcript

    if not update_fields:
        raise ApiError(400, "INVALID_PAYLOAD", "At least one editable field is required")

    try:
        block = await update_idea_block_fields(
            db,
            block_id=block_id,
            fields=update_fields,
        )
        await db.commit()
    except ApiError:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error") from exc

    await board_manager.broadcast(
        block.session_name,
        {
            "type": "update_idea_block",
            "payload": serialize_frontend_board_idea_block_update(block),
        },
    )

    return {"updated": True, "idea_block": serialize_idea_block(block)}
