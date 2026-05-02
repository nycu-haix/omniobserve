from pydantic import BaseModel, ConfigDict, Field


class TaskItemCreate(BaseModel):
    idea_block_id: int
    task_item_ids: list[int] = Field(min_length=1)


class TaskItemResponse(BaseModel):
    id: int
    idea_block_id: int
    task_item_id: int

    model_config = ConfigDict(from_attributes=True)
