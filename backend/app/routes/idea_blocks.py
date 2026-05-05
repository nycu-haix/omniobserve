from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import (
    ApiError,
    IdeaBlockCreate,
    IdeaBlockCreateRequest,
    IdeaBlockGenerationRequest,
    IdeaBlockGenerationResponse,
    IdeaBlockListResponse,
    IdeaBlockOverviewResponse,
    IdeaBlockResponse,
    IdeaBlockUpdate,
)
from ..services.idea_block_service import (
    create_idea_block,
    delete_scoped_idea_block,
    get_scoped_idea_block,
    list_idea_blocks,
    update_scoped_idea_block,
)
from ..services.transcript_pipeline import (
    generate_idea_blocks_with_task_items_from_text,
    generate_idea_blocks_with_task_items_from_transcript_ids,
    serialize_pipeline_result,
)

router = APIRouter(tags=["Idea Blocks"])


@router.get(
    "/idea-blocks",
    response_model=list[IdeaBlockOverviewResponse],
    summary="List All Idea Blocks",
)
async def read_all_idea_blocks(
    similarity_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[IdeaBlockOverviewResponse]:
    return await list_idea_blocks(db, similarity_id=similarity_id)


@router.get(
    "/sessions/{session_name}/idea-blocks",
    response_model=list[IdeaBlockOverviewResponse],
    summary="List Idea Blocks For Session",
)
async def read_all_session_idea_blocks(
    session_name: str,
    similarity_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[IdeaBlockOverviewResponse]:
    return await list_idea_blocks(db, session_name=session_name, similarity_id=similarity_id)


@router.post(
    "/sessions/{session_name}/users/{user_id}/idea-block-generations",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaBlockGenerationResponse,
    summary="Generate Idea Blocks And Task Items",
)
async def post_idea_block_generation(
    session_name: str,
    user_id: int,
    payload: IdeaBlockGenerationRequest,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockGenerationResponse:
    if payload.transcript_ids is not None:
        result = await generate_idea_blocks_with_task_items_from_transcript_ids(
            db,
            session_name=session_name,
            user_id=user_id,
            visibility=payload.visibility,
            transcript_ids=payload.transcript_ids,
        )
    elif payload.transcript_text and payload.transcript_text.strip():
        result = await generate_idea_blocks_with_task_items_from_text(
            db,
            session_name=session_name,
            user_id=user_id,
            visibility=payload.visibility,
            transcript_text=payload.transcript_text,
        )
    else:
        raise ApiError(
            400,
            "INVALID_PAYLOAD",
            "transcript_ids or transcript_text is required",
        )

    return serialize_pipeline_result(result)


@router.post(
    "/sessions/{session_name}/users/{user_id}/idea-blocks",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaBlockResponse,
    summary="Create Idea Block",
)
async def post_idea_block(
    session_name: str,
    user_id: int,
    payload: IdeaBlockCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    scoped_payload = IdeaBlockCreate(
        session_name=session_name,
        user_id=user_id,
        title=payload.title,
        summary=payload.summary,
        transcript_id=payload.transcript_id,
    )
    return await create_idea_block(scoped_payload, db)


@router.get(
    "/sessions/{session_name}/users/{user_id}/idea-blocks",
    response_model=list[IdeaBlockListResponse],
    summary="List Idea Blocks",
)
async def read_idea_blocks(
    session_name: str,
    user_id: int,
    similarity_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[IdeaBlockListResponse]:
    return await list_idea_blocks(
        db,
        user_id=user_id,
        session_name=session_name,
        similarity_id=similarity_id,
    )


@router.get(
    "/sessions/{session_name}/users/{user_id}/idea-blocks/{idea_block_id}",
    response_model=IdeaBlockResponse,
    summary="Get Idea Block By ID",
)
async def read_idea_block(
    session_name: str,
    user_id: int,
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await get_scoped_idea_block(idea_block_id, session_name=session_name, user_id=user_id, db=db)


@router.patch(
    "/sessions/{session_name}/users/{user_id}/idea-blocks/{idea_block_id}",
    response_model=IdeaBlockResponse,
    summary="Update Idea Block",
)
async def patch_idea_block(
    session_name: str,
    user_id: int,
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await update_scoped_idea_block(
        idea_block_id,
        payload,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )


@router.delete(
    "/sessions/{session_name}/users/{user_id}/idea-blocks/{idea_block_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Idea Block",
)
async def remove_idea_block(
    session_name: str,
    user_id: int,
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_scoped_idea_block(idea_block_id, session_name=session_name, user_id=user_id, db=db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
