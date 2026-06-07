from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TranscriptCreate(BaseModel):
    user_id: int
    session_name: str
    transcript: str
    visibility: str = "private"
    display_name: str | None = None


class TranscriptCreateRequest(BaseModel):
    transcript: str
    visibility: str = "private"
    display_name: str | None = None


class TranscriptResponse(BaseModel):
    id: int
    user_id: int
    session_name: str
    display_name: str | None = None
    visibility: str = "private"
    time_stamp: datetime
    transcript: str

    model_config = ConfigDict(from_attributes=True)
