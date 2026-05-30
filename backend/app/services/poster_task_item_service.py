import random

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import PosterTaskItem
from ..schemas.poster_task_item import (
    PosterTaskItemCreate,
    PosterTaskItemPatch,
    PosterTaskItemsCreateRequest,
    PosterTaskItemsReplaceRequest,
)
from ..task_config.enhance_the_poster import MAX_PRIVATE_TASK_ITEMS, TASK_ID


async def create_poster_task_items(
    *,
    session_name: str,
    user_id: int,
    payload: PosterTaskItemsCreateRequest,
    db: AsyncSession,
) -> list[PosterTaskItem]:
    validate_task_name(payload.task_name)
    existing_count = await count_user_poster_task_items(
        session_name=session_name,
        user_id=user_id,
        task_name=payload.task_name,
        db=db,
    )
    if existing_count + len(payload.items) > MAX_PRIVATE_TASK_ITEMS:
        raise HTTPException(
            status_code=400,
            detail=f"A user can submit at most {MAX_PRIVATE_TASK_ITEMS} poster task items",
        )

    task_items = [
        _build_poster_task_item(
            item,
            task_name=payload.task_name,
            session_name=session_name,
            user_id=user_id,
        )
        for item in payload.items
    ]
    db.add_all(task_items)
    await db.commit()
    for task_item in task_items:
        await db.refresh(task_item)
    return task_items


async def replace_poster_task_items(
    *,
    session_name: str,
    user_id: int,
    payload: PosterTaskItemsReplaceRequest,
    db: AsyncSession,
) -> list[PosterTaskItem]:
    validate_task_name(payload.task_name)
    await db.execute(
        delete(PosterTaskItem).where(
            PosterTaskItem.task_name == payload.task_name,
            PosterTaskItem.session_name == session_name,
            PosterTaskItem.user_id == user_id,
        )
    )

    task_items = [
        _build_poster_task_item(
            item,
            task_name=payload.task_name,
            session_name=session_name,
            user_id=user_id,
        )
        for item in payload.items
    ]
    db.add_all(task_items)
    await db.commit()
    for task_item in task_items:
        await db.refresh(task_item)
    return task_items


async def list_user_poster_task_items(
    *,
    session_name: str,
    user_id: int,
    task_name: str = TASK_ID,
    db: AsyncSession,
) -> list[PosterTaskItem]:
    validate_task_name(task_name)
    stmt = (
        select(PosterTaskItem)
        .where(
            PosterTaskItem.task_name == task_name,
            PosterTaskItem.session_name == session_name,
            PosterTaskItem.user_id == user_id,
        )
        .order_by(PosterTaskItem.id.asc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def list_session_poster_task_items(
    *,
    session_name: str,
    task_name: str = TASK_ID,
    user_id: int | None = None,
    db: AsyncSession,
) -> list[PosterTaskItem]:
    validate_task_name(task_name)
    stmt = select(PosterTaskItem).where(
        PosterTaskItem.task_name == task_name,
        PosterTaskItem.session_name == session_name,
    )
    if user_id is not None:
        stmt = stmt.where(PosterTaskItem.user_id == user_id)
    result = await db.execute(stmt.order_by(PosterTaskItem.user_id.asc(), PosterTaskItem.id.asc()))
    return list(result.scalars().all())


async def update_poster_task_item(
    *,
    id: int,
    session_name: str,
    user_id: int,
    payload: PosterTaskItemPatch,
    db: AsyncSession,
) -> PosterTaskItem:
    task_item = await get_scoped_poster_task_item(
        id=id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    update_fields = payload.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="At least one editable field is required")

    for field, value in update_fields.items():
        setattr(task_item, field, value)

    await db.commit()
    await db.refresh(task_item)
    return task_item


async def delete_poster_task_item(
    *,
    id: int,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    task_item = await get_scoped_poster_task_item(
        id=id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    await db.delete(task_item)
    await db.commit()


async def list_ranking_candidates(
    *,
    session_name: str,
    task_name: str = TASK_ID,
    db: AsyncSession,
) -> tuple[str, list[PosterTaskItem]]:
    validate_task_name(task_name)
    shuffle_seed = f"{task_name}:{session_name}"
    items = await list_session_poster_task_items(
        session_name=session_name,
        task_name=task_name,
        db=db,
    )
    shuffled_items = deduplicate_poster_task_items(items)
    random.Random(shuffle_seed).shuffle(shuffled_items)
    return shuffle_seed, shuffled_items


async def count_user_poster_task_items(
    *,
    session_name: str,
    user_id: int,
    task_name: str,
    db: AsyncSession,
) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(PosterTaskItem)
        .where(
            PosterTaskItem.task_name == task_name,
            PosterTaskItem.session_name == session_name,
            PosterTaskItem.user_id == user_id,
        )
    )
    return int(result.scalar_one())


async def get_scoped_poster_task_item(
    *,
    id: int,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> PosterTaskItem:
    result = await db.execute(
        select(PosterTaskItem).where(
            PosterTaskItem.id == id,
            PosterTaskItem.session_name == session_name,
            PosterTaskItem.user_id == user_id,
        )
    )
    task_item = result.scalar_one_or_none()
    if task_item is None:
        raise HTTPException(status_code=404, detail="Poster task item not found")
    return task_item


def _build_poster_task_item(
    item: PosterTaskItemCreate,
    *,
    task_name: str,
    session_name: str,
    user_id: int,
) -> PosterTaskItem:
    return PosterTaskItem(
        task_name=task_name,
        session_name=session_name,
        user_id=user_id,
        poster_component=item.poster_component,
        action=item.action,
        advanced_action=item.advanced_action,
    )


def deduplicate_poster_task_items(items: list[PosterTaskItem]) -> list[PosterTaskItem]:
    seen: set[tuple[str, str, str]] = set()
    deduplicated_items: list[PosterTaskItem] = []
    for item in items:
        key = (item.poster_component, item.action, item.advanced_action)
        if key in seen:
            continue
        seen.add(key)
        deduplicated_items.append(item)
    return deduplicated_items


def validate_task_name(task_name: str) -> None:
    if task_name != TASK_ID:
        raise HTTPException(status_code=400, detail="task_name is not supported")
