from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import (
    PrivatePhaseTaskItemCreate,
    PrivatePhaseTaskItemReorder,
    PrivatePhaseTaskItemResponse,
    PrivatePhaseTaskItemUpdate,
)
from ..services.private_phase_task_item_service import (
    create_private_phase_task_item,
    delete_private_phase_task_item,
    list_private_phase_task_items,
    reorder_private_phase_task_items,
    update_private_phase_task_item,
)

router = APIRouter(tags=["Private Phase Task Items"])


@router.get(
    "/sessions/{session_name}/users/{user_id}/private-phase-task-items",
    response_model=list[PrivatePhaseTaskItemResponse],
    summary="List Private Phase Task Items",
)
async def read_private_phase_task_items(
    session_name: str,
    user_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[PrivatePhaseTaskItemResponse]:
    return await list_private_phase_task_items(db, session_name=session_name, user_id=user_id)


@router.post(
    "/sessions/{session_name}/users/{user_id}/private-phase-task-items",
    status_code=status.HTTP_201_CREATED,
    response_model=PrivatePhaseTaskItemResponse,
    summary="Create Private Phase Task Item",
)
async def post_private_phase_task_item(
    session_name: str,
    user_id: int,
    payload: PrivatePhaseTaskItemCreate,
    db: AsyncSession = Depends(get_db),
) -> PrivatePhaseTaskItemResponse:
    return await create_private_phase_task_item(payload, session_name=session_name, user_id=user_id, db=db)


@router.patch(
    "/sessions/{session_name}/users/{user_id}/private-phase-task-items/{item_id}",
    response_model=PrivatePhaseTaskItemResponse,
    summary="Update Private Phase Task Item",
)
async def patch_private_phase_task_item(
    session_name: str,
    user_id: int,
    item_id: int,
    payload: PrivatePhaseTaskItemUpdate,
    db: AsyncSession = Depends(get_db),
) -> PrivatePhaseTaskItemResponse:
    return await update_private_phase_task_item(item_id, payload, session_name=session_name, user_id=user_id, db=db)


@router.post(
    "/sessions/{session_name}/users/{user_id}/private-phase-task-items/reorder",
    response_model=list[PrivatePhaseTaskItemResponse],
    summary="Reorder Private Phase Task Items",
)
async def post_private_phase_task_item_order(
    session_name: str,
    user_id: int,
    payload: PrivatePhaseTaskItemReorder,
    db: AsyncSession = Depends(get_db),
) -> list[PrivatePhaseTaskItemResponse]:
    return await reorder_private_phase_task_items(payload, session_name=session_name, user_id=user_id, db=db)


@router.delete(
    "/sessions/{session_name}/users/{user_id}/private-phase-task-items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Private Phase Task Item",
)
async def remove_private_phase_task_item(
    session_name: str,
    user_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_private_phase_task_item(item_id, session_name=session_name, user_id=user_id, db=db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
