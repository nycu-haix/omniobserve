from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import IdeaBlockCreate, IdeaBlockResponse, IdeaBlockUpdate
from ..services.idea_block_service import (
    create_idea_block,
    delete_idea_block,
    get_idea_block,
    list_idea_blocks,
    update_idea_block,
)

router = APIRouter(tags=["Idea Blocks"])


@router.post(
    "/idea-blocks",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaBlockResponse,
    summary="Create Idea Block",
)
async def post_idea_block(
    payload: IdeaBlockCreate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await create_idea_block(payload, db)


@router.get(
    "/idea-blocks",
    response_model=list[IdeaBlockResponse],
    summary="List Idea Blocks",
)
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


@router.get(
    "/idea-blocks/{idea_block_id}",
    response_model=IdeaBlockResponse,
    summary="Get Idea Block By ID",
)
async def read_idea_block(
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await get_idea_block(idea_block_id, db)


@router.patch(
    "/idea-blocks/{idea_block_id}",
    response_model=IdeaBlockResponse,
    summary="Update Idea Block",
)
async def patch_idea_block(
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    db: AsyncSession = Depends(get_db),
) -> IdeaBlockResponse:
    return await update_idea_block(idea_block_id, payload, db)


@router.delete(
    "/idea-blocks/{idea_block_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Idea Block",
)
async def remove_idea_block(
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_idea_block(idea_block_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
