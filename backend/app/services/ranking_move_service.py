from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RankingMove

MAX_RANKING_MOVE_HISTORY_LIMIT = 500


async def create_ranking_move(
    *,
    session_name: str,
    participant_id: str,
    scope: str,
    phase: str,
    move_type: str = "move",
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
        phase=phase,
        move_type=move_type,
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
    phase: str | None = None,
    move_type: str | None = None,
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
    if phase is not None:
        stmt = stmt.where(RankingMove.phase == phase)
    if move_type is not None:
        stmt = stmt.where(RankingMove.move_type == move_type)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_ranking_checkpoint(
    *,
    session_name: str,
    participant_id: str,
    scope: str,
    phase: str,
    revision: int,
    items: list[str],
    db: AsyncSession,
) -> RankingMove:
    checkpoint = RankingMove(
        session_name=session_name,
        participant_id=participant_id,
        scope=scope,
        phase=phase,
        move_type="checkpoint",
        item_id="",
        from_index=None,
        to_index=-1,
        base_revision=revision,
        revision=revision,
        previous_items=list(items),
        items=list(items),
    )
    db.add(checkpoint)
    await db.commit()
    await db.refresh(checkpoint)
    return checkpoint
