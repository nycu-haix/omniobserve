from pydantic import BaseModel, ConfigDict


class PosterIdeaBlockTaskItemResponse(BaseModel):
    id: int
    idea_block_id: int
    component_id: str
    action_id: str

    model_config = ConfigDict(from_attributes=True)
