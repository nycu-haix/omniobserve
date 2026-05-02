from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TranscriptCreate(BaseModel):
    user_id: int
    session_id: int
    transcript: str


class TranscriptResponse(BaseModel):
    id: int
    user_id: int
    session_id: int
    time_stamp: datetime
    transcript: str

    model_config = ConfigDict(from_attributes=True)
