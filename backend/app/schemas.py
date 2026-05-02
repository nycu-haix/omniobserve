from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
                "transcript_text": "請根據這段逐字稿產生 idea blocks。",
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


class GeneratedIdeaBlockResponse(BaseModel):
    id: int
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
    idea_blocks: list[GeneratedIdeaBlockResponse]


class FrontendBoardBlockCreateRequest(BaseModel):
    sessionId: str | None = None
    roomId: str | None = Field(
        default=None,
        description="Deprecated alias for sessionId. Kept for older frontend builds.",
    )
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


class IdeaBlockUpdateRequest(BaseModel):
    summary: str | None = Field(
        default=None,
        description="Editable block summary shown in board list. Maps to backend content.",
    )
    aiSummary: str | None = Field(
        default=None,
        description="Optional AI summary text shown in details tab.",
    )
    transcript: str | None = Field(
        default=None,
        description="Optional transcript text shown in details tab.",
    )


class IdeaBlockUpdateResponse(BaseModel):
    updated: bool
    idea_block: GeneratedIdeaBlockResponse


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


class IdeaBlockCreate(BaseModel):
    user_id: int
    session_name: str
    title: str
    summary: str
    transcript_id: int | None = None
    embedding_vector: list[float] | None = None

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str) -> str:
        if len(value) > 10:
            raise ValueError("title must be at most 10 characters")
        return value

    @field_validator("embedding_vector")
    @classmethod
    def validate_embedding_dim(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and len(value) != 1024:
            raise ValueError("embedding_vector must contain exactly 1024 floats")
        return value


class IdeaBlockUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    embedding_vector: list[float] | None = None
    similarity_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str | None) -> str | None:
        if value is not None and len(value) > 10:
            raise ValueError("title must be at most 10 characters")
        return value

    @field_validator("embedding_vector")
    @classmethod
    def validate_embedding_dim(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and len(value) != 1024:
            raise ValueError("embedding_vector must contain exactly 1024 floats")
        return value


class IdeaBlockResponse(BaseModel):
    id: int
    user_id: int
    session_name: str
    time_stamp: datetime
    title: str
    summary: str
    transcript_id: int | None
    embedding_vector: list[float] | None
    similarity_id: UUID | None

    model_config = ConfigDict(from_attributes=True)


class SimilarityCreate(BaseModel):
    similarity_reason: str


class SimilarityResponse(BaseModel):
    id: UUID
    similarity_reason: str

    model_config = ConfigDict(from_attributes=True)


class SimilarityAssignRequest(BaseModel):
    idea_block_a_id: int
    idea_block_b_id: int
    similarity_reason: str


class SimilarityAssignResponse(BaseModel):
    similarity_id: UUID
    idea_block_a_id: int
    idea_block_b_id: int
    similarity_reason: str
    action: str


class TaskItemCreate(BaseModel):
    idea_block_id: int
    task_item_id: int


class TaskItemResponse(BaseModel):
    id: int
    idea_block_id: int
    task_item_id: int

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockToTranscriptCreate(BaseModel):
    idea_blocks_id: int
    transcript_id: int


class IdeaBlockToTranscriptResponse(BaseModel):
    id: int
    idea_blocks_id: int
    transcript_id: int

    model_config = ConfigDict(from_attributes=True)


class FrontendMockBoardSeedRequest(BaseModel):
    sessionId: str | None = None
    roomId: str | None = Field(
        default=None,
        description="Deprecated alias for sessionId. Kept for older frontend builds.",
    )
    participantId: str | None = None
    visibility: Visibility = Field(
        default=Visibility.PRIVATE,
        description="Generated idea block visibility for mock board seed.",
    )


class FrontendMockBoardSeedResponse(BaseModel):
    accepted: bool
    transcript_count: int
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
