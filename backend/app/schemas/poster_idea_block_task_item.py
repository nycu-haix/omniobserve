from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PosterIdeaBlockTaskItemResponse(BaseModel):
    id: int
    idea_block_id: int
    component_id: str
    action_id: str

    model_config = ConfigDict(from_attributes=True)


class PosterIdeaBlockTaskItemsForIdeaBlockResponse(BaseModel):
    idea_block_id: int
    user_id: int
    session_name: str
    task_name: str
    time_stamp: datetime
    title: str
    summary: str
    task_items: list[PosterIdeaBlockTaskItemResponse]
