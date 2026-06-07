from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import PhaseTaskItemSnapshotResponse
from ..services.phase_task_item_snapshot_query_service import get_latest_phase_task_item_snapshot_response
from ..services.phase_task_item_snapshot_service import PRIVATE_PHASE_2

router = APIRouter(tags=["Phase Task Item Snapshots"])


@router.get(
    "/sessions/{session_name}/phase-task-item-snapshots/latest",
    response_model=PhaseTaskItemSnapshotResponse,
    summary="Get Latest Phase Task Item Snapshot",
)
async def read_latest_phase_task_item_snapshot(
    session_name: str,
    task_id: str | None = None,
    to_phase: str = Query(PRIVATE_PHASE_2),
    db: AsyncSession = Depends(get_db),
) -> PhaseTaskItemSnapshotResponse:
    return await get_latest_phase_task_item_snapshot_response(
        db,
        session_name=session_name,
        task_id=task_id,
        to_phase=to_phase,
    )


@router.get(
    "/sessions/{session_name}/phase-task-item-snapshot-items",
    response_model=PhaseTaskItemSnapshotResponse,
    summary="Get Latest Deduplicated Phase Task Item Snapshot Items",
)
async def read_latest_phase_task_item_snapshot_items(
    session_name: str,
    task_id: str | None = None,
    to_phase: str = Query(PRIVATE_PHASE_2),
    db: AsyncSession = Depends(get_db),
) -> PhaseTaskItemSnapshotResponse:
    return await get_latest_phase_task_item_snapshot_response(
        db,
        session_name=session_name,
        task_id=task_id,
        to_phase=to_phase,
    )

