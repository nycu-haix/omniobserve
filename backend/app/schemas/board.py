from typing import Any, Literal

from pydantic import BaseModel, Field

from ..models import Visibility


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


class GeneratedIdeaBlockResponse(BaseModel):
    id: int
    session_name: str
    task_name: str = "lost-at-sea"
    participant_id: str
    visibility: Literal["public", "private"]
    content: str
    summary: str | None
    transcript: str | None
    source_transcript_ids: list[str]
    is_deleted: bool
    created_at: str
    updated_at: str


class IdeaBlockGenerateResponse(BaseModel):
    idea_blocks: list[GeneratedIdeaBlockResponse]


class FrontendBoardBlockCreateRequest(BaseModel):
    sessionName: str | None = None
    sessionId: str | None = None
    roomId: str | None = None
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


class FrontendMockBoardSeedRequest(BaseModel):
    sessionName: str | None = None
    sessionId: str | None = None
    roomId: str | None = None
    participantId: str | None = None
    visibility: Visibility = Field(
        default=Visibility.PRIVATE,
        description="Generated idea block visibility for mock board seed.",
    )


class FrontendMockBoardSeedResponse(BaseModel):
    accepted: bool
    transcript_count: int
    generated_count: int


class TopicDescriptionResponse(BaseModel):
    topic_description: str


class TaskConfigItemResponse(BaseModel):
    id: str
    label: str
    label_zh: str
    label_en: str
    description_zh: str | None = None
    aliases: list[str]
    image_title: str
    image_bg: str
    image_fg: str
    image_mark: str


class Phase1BuilderOptionResponse(BaseModel):
    id: str
    label_zh: str
    label_en: str | None = None
    description_zh: str | None = None
    template_zh: str | None = None
    allowed_action_ids: list[str] | None = None


class Phase1BuilderResponse(BaseModel):
    enabled: bool = True
    title: str | None = None
    detail_placeholder: str | None = None
    minimum_items: int | None = None
    components: list[Phase1BuilderOptionResponse]
    actions: list[Phase1BuilderOptionResponse]


class TaskPhaseResponse(BaseModel):
    id: str
    label: str
    default_layout: dict[str, Any] | None = None


class TaskConfigResponse(BaseModel):
    task_id: str
    title: str
    template_description: str | None = None
    topic_description: str
    task_detail: str
    reference_image_src: str | None = None
    reference_image_alt: str | None = None
    phases: list[TaskPhaseResponse] = Field(default_factory=list)
    phase1_builder: Phase1BuilderResponse | None = None
    ranking_limit: int | None = None
    items: list[TaskConfigItemResponse]


class TaskTemplateResponse(BaseModel):
    task_id: str
    title: str
    session_prefix: str
    phases: list[TaskPhaseResponse] = Field(default_factory=list)
    description: str
    is_default: bool
