from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..task_config.enhance_the_poster import (
    ACTION_IDS,
    ADVANCED_ACTION_IDS,
    MAX_PRIVATE_TASK_ITEMS,
    POSTER_COMPONENT_IDS,
    TASK_ID,
)


class PosterTaskItemBase(BaseModel):
    poster_component: str = Field(min_length=1, max_length=64)
    action: str = Field(min_length=1, max_length=16)
    advanced_action: str = Field(min_length=1, max_length=64)

    @field_validator("poster_component")
    @classmethod
    def validate_poster_component(cls, value: str) -> str:
        if value not in POSTER_COMPONENT_IDS:
            raise ValueError("poster_component is not supported")
        return value

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        if value not in ACTION_IDS:
            raise ValueError("action is not supported")
        return value

    @field_validator("advanced_action")
    @classmethod
    def validate_advanced_action(cls, value: str) -> str:
        if value not in ADVANCED_ACTION_IDS:
            raise ValueError("advanced_action is not supported")
        return value


class PosterTaskItemCreate(PosterTaskItemBase):
    pass


class PosterTaskItemPatch(BaseModel):
    poster_component: str | None = Field(default=None, min_length=1, max_length=64)
    action: str | None = Field(default=None, min_length=1, max_length=16)
    advanced_action: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("poster_component")
    @classmethod
    def validate_poster_component(cls, value: str | None) -> str | None:
        if value is not None and value not in POSTER_COMPONENT_IDS:
            raise ValueError("poster_component is not supported")
        return value

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str | None) -> str | None:
        if value is not None and value not in ACTION_IDS:
            raise ValueError("action is not supported")
        return value

    @field_validator("advanced_action")
    @classmethod
    def validate_advanced_action(cls, value: str | None) -> str | None:
        if value is not None and value not in ADVANCED_ACTION_IDS:
            raise ValueError("advanced_action is not supported")
        return value


class PosterTaskItemsCreateRequest(BaseModel):
    task_name: str = TASK_ID
    items: list[PosterTaskItemCreate] = Field(min_length=1, max_length=MAX_PRIVATE_TASK_ITEMS)

    @field_validator("task_name")
    @classmethod
    def validate_task_name(cls, value: str) -> str:
        if value != TASK_ID:
            raise ValueError("task_name is not supported")
        return value


class PosterTaskItemsReplaceRequest(BaseModel):
    task_name: str = TASK_ID
    items: list[PosterTaskItemCreate] = Field(min_length=MAX_PRIVATE_TASK_ITEMS, max_length=MAX_PRIVATE_TASK_ITEMS)

    @field_validator("task_name")
    @classmethod
    def validate_task_name(cls, value: str) -> str:
        if value != TASK_ID:
            raise ValueError("task_name is not supported")
        return value


class PosterTaskItemResponse(BaseModel):
    id: int
    task_name: str
    session_name: str
    user_id: int
    poster_component: str
    action: str
    advanced_action: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PosterRankingCandidatesResponse(BaseModel):
    task_name: str
    session_name: str
    shuffle_seed: str
    items: list[PosterTaskItemResponse]


class EnhanceThePosterOptionResponse(BaseModel):
    id: str
    label_zh: str
    label_en: str


class EnhanceThePosterConfigResponse(BaseModel):
    task_id: str
    title: str
    max_private_task_items: int
    poster_components: list[EnhanceThePosterOptionResponse]
    actions: list[EnhanceThePosterOptionResponse]
    advanced_actions: list[EnhanceThePosterOptionResponse]
