from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdeaBlock, TaskItem
from ..schemas import TaskItemCreate


async def create_task_items(payload: TaskItemCreate, db: AsyncSession) -> list[TaskItem]:
    if await db.get(IdeaBlock, payload.idea_block_id) is None:
        raise HTTPException(status_code=404, detail="Idea block not found")

    task_items = [
        TaskItem(idea_block_id=payload.idea_block_id, task_item_id=task_item_id)
        for task_item_id in payload.task_item_ids
    ]
    db.add_all(task_items)
    await db.commit()
    for task_item in task_items:
        await db.refresh(task_item)
    return task_items


async def create_scoped_task_items(
    payload: TaskItemCreate,
    *,
    session_name: str,
    user_id: int,
    idea_block_id: int,
    db: AsyncSession,
) -> list[TaskItem]:
    idea_block = await _get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    scoped_payload = payload.model_copy(update={"idea_block_id": idea_block.id})
    return await create_task_items(scoped_payload, db)


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


async def list_scoped_task_items(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    idea_block_id: int | None = None,
    task_item_id: int | None = None,
) -> list[TaskItem]:
    stmt = select(TaskItem).join(IdeaBlock, TaskItem.idea_block_id == IdeaBlock.id).where(
        IdeaBlock.session_name == session_name,
        IdeaBlock.user_id == user_id,
    )
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


async def delete_scoped_task_item(
    id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    result = await db.execute(
        select(TaskItem)
        .join(IdeaBlock, TaskItem.idea_block_id == IdeaBlock.id)
        .where(
            TaskItem.id == id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
    )
    task_item = result.scalar_one_or_none()
    if task_item is None:
        raise HTTPException(status_code=404, detail="Task item mapping not found")
    await db.delete(task_item)
    await db.commit()


async def _get_scoped_idea_block(
    idea_block_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> IdeaBlock:
    result = await db.execute(
        select(IdeaBlock).where(
            IdeaBlock.id == idea_block_id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
    )
    idea_block = result.scalar_one_or_none()
    if idea_block is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    return idea_block
