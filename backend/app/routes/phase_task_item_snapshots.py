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
    description=(
        "Return the latest persisted task-item snapshot for a session/task/target phase. "
        "For enhance-the-poster, this snapshot is created when entering Private Phase 2 from the current "
        "Private Phase 1 task items. It contains the deduplicated ranking candidates used by Private Phase 2 "
        "and Public phase ranking."
    ),
)
async def read_latest_phase_task_item_snapshot(
    session_name: str,
    task_id: str | None = Query(None, description="Task id override. Defaults to the task resolved from session_name."),
    to_phase: str = Query(PRIVATE_PHASE_2, description="Snapshot target phase. Defaults to private_phase_2."),
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
    description=(
        "Convenience read for the latest deduplicated poster task item candidates. "
        "Each item has a ranking_item_id like snapshot-item:{id}; strip the prefix to join back to "
        "phase_task_item_snapshot_items. Deduplication is by component_id + action_id + statement."
    ),
)
async def read_latest_phase_task_item_snapshot_items(
    session_name: str,
    task_id: str | None = Query(None, description="Task id override. Defaults to the task resolved from session_name."),
    to_phase: str = Query(PRIVATE_PHASE_2, description="Snapshot target phase. Defaults to private_phase_2."),
    db: AsyncSession = Depends(get_db),
) -> PhaseTaskItemSnapshotResponse:
    return await get_latest_phase_task_item_snapshot_response(
        db,
        session_name=session_name,
        task_id=task_id,
        to_phase=to_phase,
    )
