from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class RankingPhaseSnapshotItemResponse(BaseModel):
    id: int
    snapshot_id: int
    item_id: str
    position: int
    label: str | None = None
    source_metadata: dict[str, Any]

    model_config = ConfigDict(from_attributes=True)


class RankingPhaseSnapshotResponse(BaseModel):
    id: int
    session_name: str
    task_id: str
    condition: str
    cue_enabled: bool
    phase: str
    scope: str
    subject_type: str
    subject_id: str
    participant_id: str | None = None
    group_id: str
    source: str
    source_phase: str | None = None
    next_phase: str | None = None
    revision: int
    change_count: int | None = None
    ranking_move_id: int | None = None
    item_count: int
    created_at: datetime
    items: list[RankingPhaseSnapshotItemResponse]

    model_config = ConfigDict(from_attributes=True)
