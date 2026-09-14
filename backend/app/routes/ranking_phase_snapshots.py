from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import RankingPhaseSnapshotResponse
from ..services.ranking_phase_snapshot_service import list_ranking_phase_snapshots

router = APIRouter(tags=["Ranking Phase Snapshots"])


@router.get(
    "/sessions/{session_name}/ranking-phase-snapshots",
    response_model=list[RankingPhaseSnapshotResponse],
    summary="List Ranking Phase Snapshots",
    description=(
        "Return durable phase-boundary ranking snapshots for a completed task run. "
        "Filter by phase, scope, participant_id, or subject_id to retrieve Private, Public, "
        "or Reflect-phase ranking orders separately for export packaging."
    ),
)
async def read_ranking_phase_snapshots(
    session_name: str,
    task_id: str | None = Query(None, description="Task id override. Defaults to the task resolved from session_name."),
    phase: str | None = Query(None, description="Optional phase filter, for example private, private_phase_2, group, or reflect."),
    scope: str | None = Query(default=None, pattern="^(private|public)$", description="Optional ranking scope filter."),
    participant_id: str | None = Query(None, description="Optional participant id filter for private snapshots."),
    subject_id: str | None = Query(None, description="Optional subject id filter. Public snapshots use the session/group id."),
    limit: int = Query(200, ge=1, le=1000, description="Maximum number of newest snapshots to return."),
    db: AsyncSession = Depends(get_db),
) -> list[RankingPhaseSnapshotResponse]:
    return await list_ranking_phase_snapshots(
        db,
        session_name=session_name,
        task_id=task_id,
        phase=phase,
        scope=scope,
        participant_id=participant_id,
        subject_id=subject_id,
        limit=limit,
    )
