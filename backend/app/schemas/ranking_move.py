from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RankingMoveResponse(BaseModel):
    id: int
    session_name: str
    participant_id: str
    scope: str
    item_id: str
    from_index: int | None = None
    to_index: int
    base_revision: int | None = None
    revision: int
    previous_items: list[str]
    items: list[str]
    time_stamp: datetime

    model_config = ConfigDict(from_attributes=True)
