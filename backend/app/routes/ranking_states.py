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
)
async def read_effective_ranking_state(
    session_name: str,
    scope: str = Query(..., pattern="^(private|public)$"),
    participant_id: str | None = None,
    task_id: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> EffectiveRankingStateResponse:
    return await get_effective_ranking_state(
        db,
        session_name=session_name,
        scope=scope,
        participant_id=participant_id,
        task_id=task_id,
    )

