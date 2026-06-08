from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..models import Visibility
from .poster_idea_block_task_item import PosterIdeaBlockTaskItemResponse
from .task_item import TaskItemResponse


class IdeaBlockCreate(BaseModel):
    user_id: int
    session_name: str
    task_name: str = "lost-at-sea"
    title: str
    summary: str
    transcript_id: int | None = None
    embedding_vector: list[float] | None = None

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str) -> str:
        if len(value) > 20:
            raise ValueError("title must be at most 20 characters")
        return value

    @field_validator("embedding_vector")
    @classmethod
    def validate_embedding_dim(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and len(value) != 1024:
            raise ValueError("embedding_vector must contain exactly 1024 floats")
        return value


class IdeaBlockCreateRequest(BaseModel):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    transcript_id: int | None = None

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str | None) -> str | None:
        if value is not None and len(value) > 20:
            raise ValueError("title must be at most 20 characters")
        return value

    @model_validator(mode="after")
    def validate_create_payload(self) -> "IdeaBlockCreateRequest":
        if self.content and self.content.strip():
            return self
        if self.title and self.title.strip() and self.summary and self.summary.strip():
            return self
        raise ValueError("content or title and summary is required")


class IdeaBlockUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    transcript: str | None = None
    embedding_vector: list[float] | None = None
    similarity_id: int | None = None

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str | None) -> str | None:
        if value is not None and len(value) > 20:
            raise ValueError("title must be at most 20 characters")
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
    task_name: str
    time_stamp: datetime
    title: str
    summary: str
    transcript_id: int | None
    transcript: str | None
    embedding_vector: list[float] | None
    similarity_id: int | None
    similarity_is_same_reason: bool | None = None
    similarity_has_same_reason: bool = False
    similarity_has_different_reason: bool = False
    is_deleted: bool
    is_duplicate: bool = False
    duplicate_of_id: int | None = None
    duplicate_reason: str | None = None
    duplicate_similarity: float | None = None

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockListResponse(BaseModel):
    id: int
    task_name: str
    time_stamp: datetime
    summary: str
    title: str
    transcript_id: int | None
    transcript: str | None
    similarity_id: int | None
    similarity_is_same_reason: bool | None = None
    similarity_has_same_reason: bool = False
    similarity_has_different_reason: bool = False
    is_deleted: bool
    is_duplicate: bool = False
    duplicate_of_id: int | None = None
    duplicate_reason: str | None = None
    duplicate_similarity: float | None = None

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockOverviewResponse(BaseModel):
    id: int
    user_id: int
    session_name: str
    task_name: str
    time_stamp: datetime
    summary: str
    title: str
    transcript_id: int | None
    transcript: str | None
    similarity_id: int | None
    similarity_is_same_reason: bool | None = None
    similarity_has_same_reason: bool = False
    similarity_has_different_reason: bool = False
    is_deleted: bool

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockGenerationRequest(BaseModel):
    transcript_text: str | None = None
    transcript_ids: list[int] | None = Field(default=None, min_length=1)
    visibility: Visibility = Visibility.PRIVATE


class IdeaBlockGenerationResponse(BaseModel):
    idea_blocks: list[IdeaBlockListResponse]
    task_items: list[TaskItemResponse | PosterIdeaBlockTaskItemResponse]
    duplicate_idea_blocks: list[IdeaBlockListResponse] = Field(default_factory=list)
