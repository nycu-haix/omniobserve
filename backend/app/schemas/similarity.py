from pydantic import BaseModel, ConfigDict


class SimilarityCreate(BaseModel):
    idea_block_id_1: int
    idea_block_id_2: int
    reason: str


class SimilarityResponse(BaseModel):
    id: int
    idea_block_id_1: int
    idea_block_id_2: int
    reason: str

    model_config = ConfigDict(from_attributes=True)


class SimilarityAssignRequest(BaseModel):
    idea_block_a_id: int
    idea_block_b_id: int
    reason: str


class SimilarityAssignResponse(BaseModel):
    id: int
    idea_block_id_1: int
    idea_block_id_2: int
    idea_block_a_id: int
    idea_block_b_id: int
    reason: str
    action: str
