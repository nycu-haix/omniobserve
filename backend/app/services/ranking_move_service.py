from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RankingMove


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
