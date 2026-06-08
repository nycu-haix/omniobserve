from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PhaseTaskItemSnapshotItemResponse(BaseModel):
    id: int
    ranking_item_id: str
    snapshot_id: int
    representative_private_phase_task_item_id: int | None = None
    component_id: str
    component_label: str
    action_id: str
    action_label: str
    statement: str
    source_user_ids: list[int]
    source_priorities: list[dict[str, Any]]
    position: int


class PhaseTaskItemSnapshotResponse(BaseModel):
    id: int
    session_name: str
    task_id: str
    from_phase: str
    to_phase: str
    shuffle_seed: str
    created_at: datetime
    items: list[PhaseTaskItemSnapshotItemResponse]

