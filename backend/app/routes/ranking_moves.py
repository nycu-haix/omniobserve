from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import RankingMoveResponse
from ..services.ranking_move_service import list_ranking_moves_by_session

router = APIRouter(tags=["Ranking Moves"])


@router.get(
    "/sessions/{session_name}/ranking-moves",
    response_model=list[RankingMoveResponse],
    summary="List Ranking Moves For Session",
    description=(
        "List raw ranking move history. "
        "Rows with move_type=move are user drag/reorder operations. "
        "Rows with move_type=checkpoint are server-saved phase boundary snapshots, currently used to preserve "
        "each participant's Private Phase 2 ranking when admin switches to Public phase. "
        "Use phase to separate Private Phase 2 rankings from private rankings edited later during Public phase."
    ),
)
async def read_session_ranking_moves(
    session_name: str,
    scope: str | None = Query(default=None, pattern="^(public|private)$", description="Optional ranking scope filter."),
    participant_id: str | None = Query(None, description="Optional participant/user id filter."),
    phase: str | None = Query(None, description="Optional phase filter, for example private_phase_2 or group."),
    move_type: str | None = Query(default=None, pattern="^(move|checkpoint)$", description="Optional move type filter."),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of newest rows to return."),
    db: AsyncSession = Depends(get_db),
) -> list[RankingMoveResponse]:
    return await list_ranking_moves_by_session(
        session_name,
        db,
        scope=scope,
        participant_id=participant_id,
        phase=phase,
        move_type=move_type,
        limit=limit,
    )
