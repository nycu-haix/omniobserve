from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageCreate(BaseModel):
    session_name: str
    user_id: int
    message: str = Field(min_length=1, max_length=2000)
    display_name: str | None = Field(default=None, max_length=255)


class ChatMessageCreateRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    display_name: str | None = Field(default=None, max_length=255)


class ChatMessageResponse(BaseModel):
    id: int
    session_name: str
    user_id: int
    display_name: str | None = None
    message: str
    time_stamp: datetime
    is_deleted: bool = False

    model_config = ConfigDict(from_attributes=True)
