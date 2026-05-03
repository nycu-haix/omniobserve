from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TranscriptCreate(BaseModel):
    user_id: int
    session_name: str
    transcript: str


class TranscriptCreateRequest(BaseModel):
    transcript: str


class TranscriptResponse(BaseModel):
    id: int
    user_id: int
    session_name: str
    time_stamp: datetime
    transcript: str

    model_config = ConfigDict(from_attributes=True)
