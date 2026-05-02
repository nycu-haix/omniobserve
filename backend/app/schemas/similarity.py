from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
