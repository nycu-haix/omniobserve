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
)
async def read_session_ranking_moves(
    session_name: str,
    scope: str | None = Query(default=None, pattern="^(public|private)$"),
    participant_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> list[RankingMoveResponse]:
    return await list_ranking_moves_by_session(
        session_name,
        db,
        scope=scope,
        participant_id=participant_id,
        limit=limit,
    )
