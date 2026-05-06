from pydantic import BaseModel, ConfigDict


class SimilarityCreate(BaseModel):
    idea_block_id_1: int
    idea_block_id_2: int
    reason: str


class SimilarityUpdate(BaseModel):
    reason: str


class IdeaBlockSummary(BaseModel):
    id: int
    summary: str

    model_config = ConfigDict(from_attributes=True)


class SimilarityResponse(BaseModel):
    id: int
    idea_block_id_1: int
    idea_block_id_2: int
    reason: str
    idea_block_1: IdeaBlockSummary
    idea_block_2: IdeaBlockSummary

    model_config = ConfigDict(from_attributes=True)
