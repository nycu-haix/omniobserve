from pydantic import BaseModel, ConfigDict


class PosterIdeaBlockTaskItemResponse(BaseModel):
    id: int
    idea_block_id: int
    poster_component: str
    action: str
    advanced_action: str

    model_config = ConfigDict(from_attributes=True)
