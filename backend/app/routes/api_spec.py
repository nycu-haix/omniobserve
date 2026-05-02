from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import (
    IdeaBlockCreate,
    IdeaBlockResponse,
    IdeaBlockToTranscriptCreate,
    IdeaBlockToTranscriptResponse,
    IdeaBlockUpdate,
    SimilarityAssignRequest,
    SimilarityAssignResponse,
    SimilarityCreate,
    SimilarityResponse,
    TaskItemCreate,
    TaskItemResponse,
    TranscriptCreate,
    TranscriptResponse,
)
from ..services.idea_block_service import (
    create_idea_block,
    delete_idea_block,
    get_idea_block,
    list_idea_blocks,
    update_idea_block,
)
from ..services.idea_block_to_transcript_service import (
    create_idea_block_to_transcript,
    delete_idea_block_to_transcript,
    list_idea_block_to_transcripts,
)
from ..services.similarity_service import (
    assign_similarity_to_idea_blocks,
    create_similarity,
    get_similarity,
    list_similarities,
)
from ..services.task_item_service import create_task_item, delete_task_item, list_task_items
from ..services.transcript_service import create_transcript, get_transcript, list_transcripts_by_session

router = APIRouter(prefix="/api")


@router.post("/transcripts", status_code=status.HTTP_201_CREATED, response_model=TranscriptResponse)
async def post_transcript(
    payload: TranscriptCreate,
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    return await create_transcript(payload, db)


@router.get("/transcripts/{transcript_id}", response_model=TranscriptResponse)
async def read_transcript(
    transcript_id: int,
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    return await get_transcript(transcript_id, db)


@router.get("/sessions/{session_id}/transcripts", response_model=list[TranscriptResponse])
async def read_session_transcripts(
    session_id: int,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptResponse]:
    return await list_transcripts_by_session(session_id, user_id, db)


@router.post("/idea-blocks", status_code=status.HTTP_201_CREATED, response_model=IdeaBlockResponse)
async def post_idea_block(
    payload: IdeaBlockCreate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await create_idea_block(payload, db)


@router.get("/idea-blocks/{idea_block_id}", response_model=IdeaBlockResponse)
async def read_idea_block(
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await get_idea_block(idea_block_id, db)


@router.get("/idea-blocks", response_model=list[IdeaBlockResponse])
async def read_idea_blocks(
    user_id: int | None = None,
    session_name: str | None = None,
    similarity_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[IdeaBlockResponse]:
    return await list_idea_blocks(
        db,
        user_id=user_id,
        session_name=session_name,
        similarity_id=similarity_id,
    )


@router.patch("/idea-blocks/{idea_block_id}", response_model=IdeaBlockResponse)
async def patch_idea_block(
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await update_idea_block(idea_block_id, payload, db)


@router.delete("/idea-blocks/{idea_block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_idea_block(
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_idea_block(idea_block_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/similarities", status_code=status.HTTP_201_CREATED, response_model=SimilarityResponse)
async def post_similarity(
    payload: SimilarityCreate,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await create_similarity(payload, db)


@router.post("/similarities/assign", response_model=SimilarityAssignResponse)
async def assign_similarity(
    payload: SimilarityAssignRequest,
    db: AsyncSession = Depends(get_db),
) -> SimilarityAssignResponse:
    return await assign_similarity_to_idea_blocks(
        payload.idea_block_a_id,
        payload.idea_block_b_id,
        payload.similarity_reason,
        db,
    )


@router.get("/similarities/{similarity_id}", response_model=SimilarityResponse)
async def read_similarity(
    similarity_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await get_similarity(similarity_id, db)


@router.get("/similarities", response_model=list[SimilarityResponse])
async def read_similarities(
    db: AsyncSession = Depends(get_db),
) -> list[SimilarityResponse]:
    return await list_similarities(db)


@router.post("/task-items", status_code=status.HTTP_201_CREATED, response_model=TaskItemResponse)
async def post_task_item(
    payload: TaskItemCreate,
    db: AsyncSession = Depends(get_db),
) -> TaskItemResponse:
    return await create_task_item(payload, db)


@router.get("/task-items", response_model=list[TaskItemResponse])
async def read_task_items(
    idea_block_id: int | None = None,
    task_item_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[TaskItemResponse]:
    return await list_task_items(db, idea_block_id=idea_block_id, task_item_id=task_item_id)


@router.delete("/task-items/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_task_item(
    id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_task_item(id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/idea-block-to-transcript",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaBlockToTranscriptResponse,
)
async def post_idea_block_to_transcript(
    payload: IdeaBlockToTranscriptCreate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockToTranscriptResponse:
    return await create_idea_block_to_transcript(payload, db)


@router.get("/idea-block-to-transcript", response_model=list[IdeaBlockToTranscriptResponse])
async def read_idea_block_to_transcripts(
    idea_blocks_id: int | None = None,
    transcript_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[IdeaBlockToTranscriptResponse]:
    return await list_idea_block_to_transcripts(
        db,
        idea_blocks_id=idea_blocks_id,
        transcript_id=transcript_id,
    )


@router.delete("/idea-block-to-transcript/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_idea_block_to_transcript(
    id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_idea_block_to_transcript(id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
