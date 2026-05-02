from pydantic import BaseModel, ConfigDict


class TaskItemCreate(BaseModel):
    idea_block_id: int
    task_item_id: int


class TaskItemResponse(BaseModel):
    id: int
    idea_block_id: int
    task_item_id: int

    model_config = ConfigDict(from_attributes=True)
