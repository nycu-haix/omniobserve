from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import TaskItemCreate, TaskItemResponse
from ..services.task_item_service import (
    create_scoped_task_items,
    delete_scoped_task_item,
    list_scoped_task_items,
)

router = APIRouter(tags=["Task Items"])


@router.post(
    "/sessions/{session_name}/users/{user_id}/idea-blocks/{idea_block_id}/task-items",
    status_code=status.HTTP_201_CREATED,
    response_model=list[TaskItemResponse],
    summary="Create Task Item Mappings",
)
async def post_task_item(
    session_name: str,
    user_id: int,
    idea_block_id: int,
    payload: TaskItemCreate,
    db: AsyncSession = Depends(get_db),
) -> list[TaskItemResponse]:
    return await create_scoped_task_items(
        payload,
        session_name=session_name,
        user_id=user_id,
        idea_block_id=idea_block_id,
        db=db,
    )


@router.get(
    "/sessions/{session_name}/users/{user_id}/idea-blocks/{idea_block_id}/task-items",
    response_model=list[TaskItemResponse],
    summary="List Task Items For Idea Block",
)
async def read_task_items_for_idea_block(
    session_name: str,
    user_id: int,
    idea_block_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[TaskItemResponse]:
    return await list_scoped_task_items(
        db,
        session_name=session_name,
        user_id=user_id,
        idea_block_id=idea_block_id,
    )


@router.get(
    "/sessions/{session_name}/users/{user_id}/task-items",
    response_model=list[TaskItemResponse],
    summary="List Task Item Mappings",
)
async def read_task_items(
    session_name: str,
    user_id: int,
    idea_block_id: int | None = None,
    task_item_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[TaskItemResponse]:
    return await list_scoped_task_items(
        db,
        session_name=session_name,
        user_id=user_id,
        idea_block_id=idea_block_id,
        task_item_id=task_item_id,
    )


@router.delete(
    "/sessions/{session_name}/users/{user_id}/task-items/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Task Item Mapping",
)
async def remove_task_item(
    session_name: str,
    user_id: int,
    id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_scoped_task_item(id, session_name=session_name, user_id=user_id, db=db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
