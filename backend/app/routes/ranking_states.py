from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import EffectiveRankingStateResponse
from ..services.ranking_state_query_service import get_effective_ranking_state

router = APIRouter(tags=["Ranking States"])


@router.get(
    "/sessions/{session_name}/ranking-state",
    response_model=EffectiveRankingStateResponse,
    summary="Get Effective Ranking State",
    description=(
        "Return the effective current/final ranking order for a session. "
        "Use scope=private with participant_id to read one participant's private ranking. "
        "Use scope=public to read the shared public ranking. "
        "When phase=private_phase_2, private rankings prefer the checkpoint saved when admin switched "
        "from Private Phase 2 to Public phase. When phase=group, private rankings return moves made "
        "during Public phase, falling back to the Private Phase 2 checkpoint if no Public-phase private "
        "move exists. If no move/checkpoint exists, the response is reconstructed from the phase task item snapshot."
    ),
)
async def read_effective_ranking_state(
    session_name: str,
    scope: str = Query(..., pattern="^(private|public)$", description="Ranking scope: private per participant, or public shared ranking."),
    participant_id: str | None = Query(None, description="Required when scope=private. Matches the board participant/user id."),
    task_id: str | None = Query(None, description="Task id override. Defaults to the task resolved from session_name."),
    phase: str | None = Query(None, description="Optional phase filter, for example private_phase_2 or group."),
    db: AsyncSession = Depends(get_db),
) -> EffectiveRankingStateResponse:
    return await get_effective_ranking_state(
        db,
        session_name=session_name,
        scope=scope,
        participant_id=participant_id,
        task_id=task_id,
        phase=phase,
    )

