from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import PrivatePhaseTaskItem
from ..schemas.private_phase_task_item import (
    PrivatePhaseTaskItemCreate,
    PrivatePhaseTaskItemReorder,
    PrivatePhaseTaskItemUpdate,
)
from ..task_config import get_task_config_for_session, resolve_task_id


def _normalize_detail(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _option_label(option: dict[str, Any]) -> str:
    return str(option.get("label_zh") or option.get("label") or option.get("id") or "")


def _build_statement(component: dict[str, Any], action: dict[str, Any], detail: str) -> str:
    component_label = _option_label(component)
    action_label = _option_label(action)
    template = str(action.get("template_zh") or "").strip()
    if template:
        statement = template.replace("{component}", component_label)
    else:
        statement = f"{action_label}「{component_label}」"
    if detail:
        statement = f"{statement}：{detail}"
    return statement


def _resolve_builder_options(
    *,
    session_name: str,
    task_id: str | None = None,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    resolved_task_id = resolve_task_id(session_name=session_name, task_id=task_id)
    config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_id)
    builder = config.get("phase1_builder") or {}
    if not builder.get("enabled"):
        raise HTTPException(status_code=404, detail="Private Phase 1 builder is not configured for this task")

    components = {str(item["id"]): item for item in builder.get("components", []) if item.get("id")}
    actions = {str(item["id"]): item for item in builder.get("actions", []) if item.get("id")}
    if not components or not actions:
        raise HTTPException(status_code=404, detail="Private Phase 1 builder is incomplete for this task")
    return resolved_task_id, components, actions


def _resolve_component_action(
    *,
    session_name: str,
    task_id: str | None,
    component_id: str,
    action_id: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    resolved_task_id, components, actions = _resolve_builder_options(session_name=session_name, task_id=task_id)
    component = components.get(component_id.strip())
    if component is None:
        raise HTTPException(status_code=422, detail="Unknown poster component")
    action = actions.get(action_id.strip())
    if action is None:
        raise HTTPException(status_code=422, detail="Unknown action item")
    return resolved_task_id, component, action


async def list_private_phase_task_items(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    task_id: str | None = None,
) -> list[PrivatePhaseTaskItem]:
    resolved_task_id = resolve_task_id(session_name=session_name, task_id=task_id)
    stmt = (
        select(PrivatePhaseTaskItem)
        .where(
            PrivatePhaseTaskItem.session_name == session_name,
            PrivatePhaseTaskItem.user_id == user_id,
            PrivatePhaseTaskItem.task_id == resolved_task_id,
        )
        .order_by(PrivatePhaseTaskItem.priority.asc(), PrivatePhaseTaskItem.id.asc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_private_phase_task_item(
    payload: PrivatePhaseTaskItemCreate,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> PrivatePhaseTaskItem:
    detail = _normalize_detail(payload.detail)
    resolved_task_id, component, action = _resolve_component_action(
        session_name=session_name,
        task_id=payload.task_id,
        component_id=payload.component_id,
        action_id=payload.action_id,
    )

    max_priority = await db.scalar(
        select(func.max(PrivatePhaseTaskItem.priority)).where(
            PrivatePhaseTaskItem.session_name == session_name,
            PrivatePhaseTaskItem.user_id == user_id,
            PrivatePhaseTaskItem.task_id == resolved_task_id,
        )
    )
    next_priority = payload.priority if payload.priority is not None else int(max_priority or 0) + 1
    item = PrivatePhaseTaskItem(
        session_name=session_name,
        user_id=user_id,
        task_id=resolved_task_id,
        component_id=str(component["id"]),
        component_label=_option_label(component),
        action_id=str(action["id"]),
        action_label=_option_label(action),
        detail=detail,
        statement=_build_statement(component, action, detail),
        priority=next_priority,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    await normalize_private_phase_task_item_priorities(
        db,
        session_name=session_name,
        user_id=user_id,
        task_id=resolved_task_id,
    )
    await db.refresh(item)
    return item


async def update_private_phase_task_item(
    item_id: int,
    payload: PrivatePhaseTaskItemUpdate,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> PrivatePhaseTaskItem:
    item = await get_private_phase_task_item(item_id, session_name=session_name, user_id=user_id, db=db)
    component_id = payload.component_id if payload.component_id is not None else item.component_id
    action_id = payload.action_id if payload.action_id is not None else item.action_id
    detail = _normalize_detail(payload.detail if payload.detail is not None else item.detail)
    _, component, action = _resolve_component_action(
        session_name=session_name,
        task_id=item.task_id,
        component_id=component_id,
        action_id=action_id,
    )

    item.component_id = str(component["id"])
    item.component_label = _option_label(component)
    item.action_id = str(action["id"])
    item.action_label = _option_label(action)
    item.detail = detail
    item.statement = _build_statement(component, action, detail)
    if payload.priority is not None:
        item.priority = payload.priority

    await db.commit()
    await db.refresh(item)
    await normalize_private_phase_task_item_priorities(
        db,
        session_name=session_name,
        user_id=user_id,
        task_id=item.task_id,
    )
    await db.refresh(item)
    return item


async def reorder_private_phase_task_items(
    payload: PrivatePhaseTaskItemReorder,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> list[PrivatePhaseTaskItem]:
    scoped_items = await list_private_phase_task_items(db, session_name=session_name, user_id=user_id)
    scoped_by_id = {item.id: item for item in scoped_items}
    requested_ids = payload.item_ids
    if len(requested_ids) != len(scoped_by_id) or set(requested_ids) != set(scoped_by_id):
        raise HTTPException(status_code=422, detail="Reorder payload must include every private phase task item")

    for priority, item_id in enumerate(requested_ids, start=1):
        scoped_by_id[item_id].priority = priority

    await db.commit()
    return await list_private_phase_task_items(db, session_name=session_name, user_id=user_id)


async def delete_private_phase_task_item(
    item_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    item = await get_private_phase_task_item(item_id, session_name=session_name, user_id=user_id, db=db)
    task_id = item.task_id
    await db.delete(item)
    await db.commit()
    await normalize_private_phase_task_item_priorities(
        db,
        session_name=session_name,
        user_id=user_id,
        task_id=task_id,
    )


async def get_private_phase_task_item(
    item_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> PrivatePhaseTaskItem:
    stmt = select(PrivatePhaseTaskItem).where(
        PrivatePhaseTaskItem.id == item_id,
        PrivatePhaseTaskItem.session_name == session_name,
        PrivatePhaseTaskItem.user_id == user_id,
    )
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Private phase task item not found")
    return item


async def normalize_private_phase_task_item_priorities(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    task_id: str,
) -> None:
    items = await list_private_phase_task_items(db, session_name=session_name, user_id=user_id, task_id=task_id)
    changed = False
    for index, item in enumerate(items, start=1):
        if item.priority != index:
            item.priority = index
            changed = True
    if changed:
        await db.commit()
