from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RankingMove

MAX_RANKING_MOVE_HISTORY_LIMIT = 500


async def create_ranking_move(
    *,
    session_name: str,
    participant_id: str,
    scope: str,
    item_id: str,
    from_index: int | None,
    to_index: int,
    base_revision: int | None,
    revision: int,
    previous_items: list[str],
    items: list[str],
    db: AsyncSession,
) -> RankingMove:
    ranking_move = RankingMove(
        session_name=session_name,
        participant_id=participant_id,
        scope=scope,
        item_id=item_id,
        from_index=from_index,
        to_index=to_index,
        base_revision=base_revision,
        revision=revision,
        previous_items=list(previous_items),
        items=list(items),
    )
    db.add(ranking_move)
    await db.commit()
    await db.refresh(ranking_move)
    return ranking_move


async def list_ranking_moves_by_session(
    session_name: str,
    db: AsyncSession,
    *,
    scope: str | None = None,
    participant_id: str | None = None,
    limit: int = 100,
) -> list[RankingMove]:
    bounded_limit = min(max(limit, 1), MAX_RANKING_MOVE_HISTORY_LIMIT)
    stmt = (
        select(RankingMove)
        .where(RankingMove.session_name == session_name)
        .order_by(RankingMove.time_stamp.desc(), RankingMove.id.desc())
        .limit(bounded_limit)
    )
    if scope is not None:
        stmt = stmt.where(RankingMove.scope == scope)
    if participant_id is not None:
        stmt = stmt.where(RankingMove.participant_id == participant_id)

    result = await db.execute(stmt)
    return list(result.scalars().all())
