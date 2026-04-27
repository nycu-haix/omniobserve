from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

from .models import Visibility


class TranscriptCreateRequest(BaseModel):
    participant_id: str
    visibility: Visibility
    text: str
    source_audio_id: str | None = None
    started_at: str
    ended_at: str


class IdeaBlockGenerateRequest(BaseModel):
    participant_id: str
    visibility: Visibility
    source_transcript_ids: list[str] = Field(min_length=1)


@dataclass
class StreamContext:
    scope: Visibility
    sample_rate: int
    client_id: str | None
    source: str | None
    agent_type: str | None
    encoding: str | None
    channels: int
    start_message: dict[str, Any]


@dataclass
class StreamTranscript:
    segment_id: str
    text: str


class ApiError(Exception):
    def __init__(self, status_code: int, error_code: str, message: str):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        super().__init__(message)
