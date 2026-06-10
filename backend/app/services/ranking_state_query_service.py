from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import RankingMove
from ..schemas import ApiError
from ..task_config import get_ranking_limit_for_session, resolve_task_id
from .phase_task_item_snapshot_service import (
    GROUP_PHASE,
    PRIVATE_PHASE_2,
    build_private_phase_2_order,
    get_phase_snapshot,
    snapshot_item_id,
    stable_shuffle,
)
from .ranking_cutoff import normalize_ranking_change_count, split_ranking_items


def _ranking_items_response(
    *,
    session_name: str,
    task_id: str,
    items: list[str],
) -> dict:
    real_items, change_count = split_ranking_items(items)
    payload: dict = {"items": real_items}
    ranking_limit = get_ranking_limit_for_session(
        session_name=session_name,
        task_id=task_id,
    )
    if ranking_limit is not None:
        payload["change_count"] = normalize_ranking_change_count(
            change_count,
            ranking_limit=ranking_limit,
            item_count=len(real_items),
        )
    return payload


async def get_effective_ranking_state(
    db: AsyncSession,
    *,
    session_name: str,
    scope: str,
    participant_id: str | None = None,
    task_id: str | None = None,
    phase: str | None = None,
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
        phase=phase,
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
        ranking_payload = _ranking_items_response(
            session_name=session_name,
            task_id=resolved_task_id,
            items=list(latest_move.items or []),
        )
        return {
            "session_name": session_name,
            "scope": normalized_scope,
            "participant_id": latest_move.participant_id if normalized_scope == "private" else None,
            "task_id": resolved_task_id,
            "snapshot_id": snapshot.id,
            "phase": latest_move.phase,
            "source": latest_move.move_type,
            "revision": latest_move.revision,
            **ranking_payload,
            "ranking_move_id": latest_move.id,
            "updated_at": latest_move.time_stamp,
        }

    fallback_checkpoint = None
    if normalized_scope == "private" and phase == GROUP_PHASE:
        fallback_checkpoint = await _get_latest_ranking_move(
            db,
            session_name=session_name,
            scope=normalized_scope,
            participant_id=participant_id,
            phase=PRIVATE_PHASE_2,
            move_type="checkpoint",
        )
    if fallback_checkpoint is not None:
        ranking_payload = _ranking_items_response(
            session_name=session_name,
            task_id=resolved_task_id,
            items=list(fallback_checkpoint.items or []),
        )
        return {
            "session_name": session_name,
            "scope": normalized_scope,
            "participant_id": fallback_checkpoint.participant_id,
            "task_id": resolved_task_id,
            "snapshot_id": snapshot.id,
            "phase": fallback_checkpoint.phase,
            "source": "private_phase_2_checkpoint",
            "revision": fallback_checkpoint.revision,
            **ranking_payload,
            "ranking_move_id": fallback_checkpoint.id,
            "updated_at": fallback_checkpoint.time_stamp,
        }

    if normalized_scope == "private":
        items = build_private_phase_2_order(snapshot.items, str(participant_id))
    else:
        items = stable_shuffle(
            [snapshot_item_id(item.id) for item in snapshot.items],
            f"{session_name}:{resolved_task_id}:{GROUP_PHASE}:{snapshot.id}",
        )

    ranking_payload = _ranking_items_response(
        session_name=session_name,
        task_id=resolved_task_id,
        items=items,
    )
    return {
        "session_name": session_name,
        "scope": normalized_scope,
        "participant_id": str(participant_id) if normalized_scope == "private" else None,
        "task_id": resolved_task_id,
        "snapshot_id": snapshot.id,
        "phase": phase,
        "source": "snapshot_initial",
        "revision": 0,
        **ranking_payload,
        "ranking_move_id": None,
        "updated_at": snapshot.created_at,
    }


async def _get_latest_ranking_move(
    db: AsyncSession,
    *,
    session_name: str,
    scope: str,
    participant_id: str | None,
    phase: str | None = None,
    move_type: str | None = None,
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
    if phase is not None:
        stmt = stmt.where(RankingMove.phase == phase)
    if move_type is not None:
        stmt = stmt.where(RankingMove.move_type == move_type)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
