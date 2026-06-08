from datetime import datetime

from pydantic import BaseModel


class EffectiveRankingStateResponse(BaseModel):
    session_name: str
    scope: str
    participant_id: str | None = None
    task_id: str
    snapshot_id: int
    phase: str | None = None
    source: str
    revision: int
    items: list[str]
    ranking_move_id: int | None = None
    updated_at: datetime | None = None

