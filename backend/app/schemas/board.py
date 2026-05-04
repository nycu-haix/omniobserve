from typing import Literal

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
