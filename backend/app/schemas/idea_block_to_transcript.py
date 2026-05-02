from pydantic import BaseModel, ConfigDict


class IdeaBlockToTranscriptCreate(BaseModel):
    idea_blocks_id: int
    transcript_id: int


class IdeaBlockToTranscriptResponse(BaseModel):
    id: int
    idea_blocks_id: int
    transcript_id: int

    model_config = ConfigDict(from_attributes=True)
