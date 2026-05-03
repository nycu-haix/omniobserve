from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import IdeaBlockToTranscriptCreate, IdeaBlockToTranscriptResponse
from ..services.idea_block_to_transcript_service import (
    create_scoped_idea_block_to_transcript,
    delete_scoped_idea_block_to_transcript,
    list_scoped_idea_block_to_transcripts,
)

router = APIRouter(tags=["Idea Block To Transcript"])


@router.post(
    "/sessions/{session_name}/users/{user_id}/idea-block-to-transcript",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaBlockToTranscriptResponse,
    summary="Create Idea Block To Transcript Mapping",
)
async def post_idea_block_to_transcript(
    session_name: str,
    user_id: int,
    payload: IdeaBlockToTranscriptCreate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockToTranscriptResponse:
    return await create_scoped_idea_block_to_transcript(
        payload,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )


@router.get(
    "/sessions/{session_name}/users/{user_id}/idea-block-to-transcript",
    response_model=list[IdeaBlockToTranscriptResponse],
    summary="List Idea Block To Transcript Mappings",
)
async def read_idea_block_to_transcripts(
    session_name: str,
    user_id: int,
    idea_blocks_id: int | None = None,
    transcript_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[IdeaBlockToTranscriptResponse]:
    return await list_scoped_idea_block_to_transcripts(
        db,
        session_name=session_name,
        user_id=user_id,
        idea_blocks_id=idea_blocks_id,
        transcript_id=transcript_id,
    )


@router.delete(
    "/sessions/{session_name}/users/{user_id}/idea-block-to-transcript/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Idea Block To Transcript Mapping",
)
async def remove_idea_block_to_transcript(
    session_name: str,
    user_id: int,
    id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_scoped_idea_block_to_transcript(id, session_name=session_name, user_id=user_id, db=db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
