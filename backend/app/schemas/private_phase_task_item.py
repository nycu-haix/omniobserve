from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PrivatePhaseTaskItemCreate(BaseModel):
    task_id: str | None = Field(default=None, max_length=80)
    component_id: str = Field(min_length=1, max_length=80)
    action_id: str = Field(min_length=1, max_length=80)
    detail: str = Field(default="", max_length=280)
    priority: int | None = Field(default=None, ge=1)


class PrivatePhaseTaskItemUpdate(BaseModel):
    component_id: str | None = Field(default=None, min_length=1, max_length=80)
    action_id: str | None = Field(default=None, min_length=1, max_length=80)
    detail: str | None = Field(default=None, max_length=280)
    priority: int | None = Field(default=None, ge=1)


class PrivatePhaseTaskItemReorder(BaseModel):
    item_ids: list[int] = Field(min_length=1)


class PrivatePhaseTaskItemResponse(BaseModel):
    id: int
    session_name: str
    user_id: int
    task_id: str
    component_id: str
    component_label: str
    action_id: str
    action_label: str
    detail: str
    statement: str
    priority: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
