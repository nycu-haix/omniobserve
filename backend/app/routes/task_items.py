from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import TaskItemCreate, TaskItemResponse
from ..services.task_item_service import create_task_item, delete_task_item, list_task_items

router = APIRouter(tags=["Task Items"])


@router.post(
    "/task-items",
    status_code=status.HTTP_201_CREATED,
    response_model=TaskItemResponse,
    summary="Create Task Item Mapping",
)
async def post_task_item(
    payload: TaskItemCreate,
    db: AsyncSession = Depends(get_db),
) -> TaskItemResponse:
    return await create_task_item(payload, db)


@router.get(
    "/task-items",
    response_model=list[TaskItemResponse],
    summary="List Task Item Mappings",
)
async def read_task_items(
    idea_block_id: int | None = None,
    task_item_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[TaskItemResponse]:
    return await list_task_items(db, idea_block_id=idea_block_id, task_item_id=task_item_id)


@router.delete(
    "/task-items/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Task Item Mapping",
)
async def remove_task_item(
    id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_task_item(id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
