from pydantic import BaseModel, ConfigDict


class SimilarityCreate(BaseModel):
    idea_block_id_1: int
    idea_block_id_2: int
    reason: str
    is_same_reason: bool = True


class SimilarityUpdate(BaseModel):
    reason: str | None = None
    is_same_reason: bool | None = None


class IdeaBlockSummary(BaseModel):
    id: int
    summary: str

    model_config = ConfigDict(from_attributes=True)


class SimilarityResponse(BaseModel):
    id: int
    idea_block_id_1: int
    idea_block_id_2: int
    reason: str
    is_same_reason: bool
    idea_block_1: IdeaBlockSummary
    idea_block_2: IdeaBlockSummary

    model_config = ConfigDict(from_attributes=True)
