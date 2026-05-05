from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models import Visibility
from .task_item import TaskItemResponse


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


class IdeaBlockCreateRequest(BaseModel):
    title: str
    summary: str
    transcript_id: int | None = None

    @field_validator("title")
    @classmethod
    def validate_title_length(cls, value: str) -> str:
        if len(value) > 10:
            raise ValueError("title must be at most 10 characters")
        return value


class IdeaBlockUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    transcript: str | None = None
    embedding_vector: list[float] | None = None
    similarity_id: int | None = None

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
    transcript: str | None
    embedding_vector: list[float] | None
    similarity_id: int | None

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockListResponse(BaseModel):
    id: int
    summary: str
    title: str
    transcript: str | None
    similarity_id: int | None

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockOverviewResponse(BaseModel):
    id: int
    user_id: int
    session_name: str
    summary: str
    title: str
    transcript: str | None
    similarity_id: int | None

    model_config = ConfigDict(from_attributes=True)


class IdeaBlockGenerationRequest(BaseModel):
    transcript_text: str | None = None
    transcript_ids: list[int] | None = Field(default=None, min_length=1)
    visibility: Visibility = Visibility.PRIVATE


class IdeaBlockGenerationResponse(BaseModel):
    idea_blocks: list[IdeaBlockListResponse]
    task_items: list[TaskItemResponse]
