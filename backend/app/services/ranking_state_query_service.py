from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RankingMove
from ..schemas import ApiError
from ..task_config import resolve_task_id
from .phase_task_item_snapshot_service import (
    GROUP_PHASE,
    PRIVATE_PHASE_2,
    build_private_phase_2_order,
    get_phase_snapshot,
    snapshot_item_id,
    stable_shuffle,
)


async def get_effective_ranking_state(
    db: AsyncSession,
    *,
    session_name: str,
    scope: str,
    participant_id: str | None = None,
    task_id: str | None = None,
) -> dict:
    normalized_scope = scope.strip().lower()
    if normalized_scope not in {"private", "public"}:
        raise ApiError(400, "INVALID_RANKING_SCOPE", "scope must be private or public")
    if normalized_scope == "private" and not participant_id:
        raise ApiError(400, "PARTICIPANT_ID_REQUIRED", "participant_id is required for private ranking state")

    latest_move = await _get_latest_ranking_move(
        db,
        session_name=session_name,
        scope=normalized_scope,
        participant_id=participant_id if normalized_scope == "private" else None,
    )
    resolved_task_id = task_id or resolve_task_id(session_name=session_name)
    snapshot = await get_phase_snapshot(
        db,
        session_name=session_name,
        task_id=resolved_task_id,
        to_phase=PRIVATE_PHASE_2,
    )
    if snapshot is None:
        raise ApiError(
            404,
            "PHASE_TASK_ITEM_SNAPSHOT_NOT_FOUND",
            "Phase task item snapshot not found",
        )

    if latest_move is not None:
        return {
            "session_name": session_name,
            "scope": normalized_scope,
            "participant_id": latest_move.participant_id if normalized_scope == "private" else None,
            "task_id": resolved_task_id,
            "snapshot_id": snapshot.id,
            "source": "move",
            "revision": latest_move.revision,
            "items": list(latest_move.items or []),
            "ranking_move_id": latest_move.id,
            "updated_at": latest_move.time_stamp,
        }

    if normalized_scope == "private":
        items = build_private_phase_2_order(snapshot.items, str(participant_id))
    else:
        items = stable_shuffle(
            [snapshot_item_id(item.id) for item in snapshot.items],
            f"{session_name}:{resolved_task_id}:{GROUP_PHASE}:{snapshot.id}",
        )

    return {
        "session_name": session_name,
        "scope": normalized_scope,
        "participant_id": str(participant_id) if normalized_scope == "private" else None,
        "task_id": resolved_task_id,
        "snapshot_id": snapshot.id,
        "source": "snapshot_initial",
        "revision": 0,
        "items": items,
        "ranking_move_id": None,
        "updated_at": snapshot.created_at,
    }


async def _get_latest_ranking_move(
    db: AsyncSession,
    *,
    session_name: str,
    scope: str,
    participant_id: str | None,
) -> RankingMove | None:
    stmt = (
        select(RankingMove)
        .where(
            RankingMove.session_name == session_name,
            RankingMove.scope == scope,
        )
        .order_by(RankingMove.time_stamp.desc(), RankingMove.id.desc())
        .limit(1)
    )
    if participant_id is not None:
        stmt = stmt.where(RankingMove.participant_id == participant_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

