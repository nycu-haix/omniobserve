from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdeaBlock, TaskItem
from ..schemas import TaskItemCreate


async def create_task_item(payload: TaskItemCreate, db: AsyncSession) -> TaskItem:
    if await db.get(IdeaBlock, payload.idea_block_id) is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    task_item = TaskItem(**payload.model_dump())
    db.add(task_item)
    await db.commit()
    await db.refresh(task_item)
    return task_item


async def list_task_items(
    db: AsyncSession,
    *,
    idea_block_id: int | None = None,
    task_item_id: int | None = None,
) -> list[TaskItem]:
    stmt = select(TaskItem)
    if idea_block_id is not None:
        stmt = stmt.where(TaskItem.idea_block_id == idea_block_id)
    if task_item_id is not None:
        stmt = stmt.where(TaskItem.task_item_id == task_item_id)
    result = await db.execute(stmt.order_by(TaskItem.id.asc()))
    return list(result.scalars().all())


async def delete_task_item(id: int, db: AsyncSession) -> None:
    task_item = await db.get(TaskItem, id)
    if task_item is None:
        raise HTTPException(status_code=404, detail="Task item mapping not found")
    await db.delete(task_item)
    await db.commit()
