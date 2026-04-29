from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

from .models import Visibility


class IdeaBlockGenerateRequest(BaseModel):
    participant_id: str
    visibility: Visibility
    transcript_text: str | None = Field(
        default=None,
        description="Transcript content to be processed by LLM",
    )
    use_mock_transcript: bool = Field(
        default=False,
        description="When true, ignore transcript_text and use backend mock transcript",
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "participant_id": "p1",
                "visibility": "public",
                "transcript_text": "大家好，今天要確認 API 設計方向。",
                "use_mock_transcript": False,
            }
        }
    }


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


class IdeaBlockResponse(BaseModel):
    id: str
    session_id: str
    participant_id: str
    visibility: Literal["public", "private"]
    content: str
    summary: str | None
    transcript: str | None
    source_transcript_ids: list[str]
    created_at: str
    updated_at: str


class IdeaBlockGenerateResponse(BaseModel):
    idea_blocks: list[IdeaBlockResponse]


class FrontendBoardBlockCreateRequest(BaseModel):
    roomId: str
    participantId: str | None = None
    transcript_text: str | None = Field(
        default=None,
        description="Optional transcript override. If omitted, backend frontend-mock transcript is used.",
    )
    use_mock_transcript: bool = Field(
        default=True,
        description="When true and transcript_text is empty, use backend's frontend mock transcript.",
    )
    visibility: Visibility = Field(
        default=Visibility.PRIVATE,
        description="Generated idea block visibility.",
    )


class FrontendBoardBlockCreateResponse(BaseModel):
    accepted: bool
    generated_count: int


class ErrorResponse(BaseModel):
    error_code: str
    message: str
    details: Any | None = None


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        details: Any | None = None,
    ):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.details = details
        super().__init__(message)
