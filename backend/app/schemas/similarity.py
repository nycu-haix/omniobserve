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
