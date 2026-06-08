from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas import ApiError
from ..task_config import resolve_task_id
from .phase_task_item_snapshot_service import (
    PRIVATE_PHASE_2,
    get_phase_snapshot,
    snapshot_item_id,
)


async def get_latest_phase_task_item_snapshot_response(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str | None = None,
    to_phase: str = PRIVATE_PHASE_2,
) -> dict:
    resolved_task_id = task_id or resolve_task_id(session_name=session_name)
    snapshot = await get_phase_snapshot(
        db,
        session_name=session_name,
        task_id=resolved_task_id,
        to_phase=to_phase,
    )
    if snapshot is None:
        raise ApiError(
            404,
            "PHASE_TASK_ITEM_SNAPSHOT_NOT_FOUND",
            "Phase task item snapshot not found",
        )

    return {
        "id": snapshot.id,
        "session_name": snapshot.session_name,
        "task_id": snapshot.task_id,
        "from_phase": snapshot.from_phase,
        "to_phase": snapshot.to_phase,
        "shuffle_seed": snapshot.shuffle_seed,
        "created_at": snapshot.created_at,
        "items": [
            {
                "id": item.id,
                "ranking_item_id": snapshot_item_id(item.id),
                "snapshot_id": item.snapshot_id,
                "representative_private_phase_task_item_id": item.representative_private_phase_task_item_id,
                "component_id": item.component_id,
                "component_label": item.component_label,
                "action_id": item.action_id,
                "action_label": item.action_label,
                "statement": item.statement,
                "source_user_ids": list(item.source_user_ids or []),
                "source_priorities": list(item.source_priorities or []),
                "position": item.position,
            }
            for item in sorted(snapshot.items, key=lambda value: (value.position, value.id))
        ],
    }

