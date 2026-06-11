from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import logger
from ..models import PrivatePhaseTaskItem, RankingMove, RankingPhaseSnapshot, RankingPhaseSnapshotItem
from ..task_config import get_ranking_items_for_session, get_task_config_for_session, resolve_task_id
from .phase_task_item_snapshot_service import (
    ENHANCE_THE_POSTER_TASK_ID,
    GROUP_PHASE,
    PRIVATE_PHASE_1,
    PRIVATE_PHASE_2,
    build_private_phase_2_order,
    get_phase_snapshot,
    snapshot_item_id,
    stable_shuffle,
)
from .ranking_cutoff import split_ranking_items

MAX_SNAPSHOT_LIST_LIMIT = 1000
PRIVATE_PHASE_TASK_ITEM_ID_PREFIX = "private-phase-task-item:"


@dataclass(frozen=True)
class RankingSnapshotItemInput:
    item_id: str
    label: str | None = None
    source_metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class RankingStateSnapshotInput:
    revision: int
    items: list[str]
    change_count: int | None = None
    ranking_move_id: int | None = None
    source: str = "phase_boundary"


async def create_phase_boundary_ranking_snapshots(
    db: AsyncSession,
    *,
    session_name: str,
    from_phase: str,
    to_phase: str,
    condition: str,
    cue_enabled: bool,
    participant_ids: list[str],
    private_ranking_states: Mapping[str, Mapping[str, Any]] | None = None,
    public_ranking_state: Mapping[str, Any] | None = None,
    ranking_item_catalog: list[dict[str, Any]] | None = None,
) -> list[RankingPhaseSnapshot]:
    if from_phase == to_phase:
        return []

    task_id = resolve_task_id(session_name=session_name)
    normalized_condition, normalized_cue_enabled = _normalize_snapshot_condition(
        session_name=session_name,
        condition=condition,
        cue_enabled=cue_enabled,
    )
    known_participant_ids = await _load_known_participant_ids(
        db,
        session_name=session_name,
        task_id=task_id,
        participant_ids=participant_ids,
    )
    catalog_by_id = _ranking_item_catalog_by_id(
        session_name=session_name,
        task_id=task_id,
        ranking_item_catalog=ranking_item_catalog,
    )

    snapshots: list[RankingPhaseSnapshot] = []
    if task_id == ENHANCE_THE_POSTER_TASK_ID and from_phase == PRIVATE_PHASE_1:
        snapshots.extend(
            await _snapshot_private_phase_task_items(
                db,
                session_name=session_name,
                task_id=task_id,
                phase=from_phase,
                next_phase=to_phase,
                condition=normalized_condition,
                cue_enabled=normalized_cue_enabled,
                participant_ids=known_participant_ids,
            )
        )
        await db.commit()
        return snapshots

    for participant_id in known_participant_ids:
        state = await _resolve_private_ranking_state(
            db,
            session_name=session_name,
            task_id=task_id,
            participant_id=participant_id,
            phase=from_phase,
            private_ranking_states=private_ranking_states,
        )
        snapshots.append(
            await _create_ranking_snapshot(
                db,
                session_name=session_name,
                task_id=task_id,
                condition=normalized_condition,
                cue_enabled=normalized_cue_enabled,
                phase=from_phase,
                scope="private",
                subject_type="participant",
                subject_id=participant_id,
                participant_id=participant_id,
                group_id=session_name,
                source=state.source,
                source_phase=from_phase,
                next_phase=to_phase,
                revision=state.revision,
                change_count=state.change_count,
                ranking_move_id=state.ranking_move_id,
                ordered_items=_items_for_ranking_order(state.items, catalog_by_id),
            )
        )

    public_state = await _resolve_public_ranking_state(
        db,
        session_name=session_name,
        task_id=task_id,
        phase=from_phase,
        public_ranking_state=public_ranking_state,
        should_capture_default=from_phase == GROUP_PHASE,
    )
    if public_state is not None:
        snapshots.append(
            await _create_ranking_snapshot(
                db,
                session_name=session_name,
                task_id=task_id,
                condition=normalized_condition,
                cue_enabled=normalized_cue_enabled,
                phase=from_phase,
                scope="public",
                subject_type="group",
                subject_id=session_name,
                participant_id=None,
                group_id=session_name,
                source=public_state.source,
                source_phase=from_phase,
                next_phase=to_phase,
                revision=public_state.revision,
                change_count=public_state.change_count,
                ranking_move_id=public_state.ranking_move_id,
                ordered_items=_items_for_ranking_order(public_state.items, catalog_by_id),
            )
        )

    await db.commit()
    logger.info(
        "ranking_phase_snapshots_created session_name=%s task_id=%s from_phase=%s to_phase=%s count=%s condition=%s cue_enabled=%s",
        session_name,
        task_id,
        from_phase,
        to_phase,
        len(snapshots),
        normalized_condition,
        normalized_cue_enabled,
    )
    return snapshots


async def create_reflect_ranking_move_snapshot(
    db: AsyncSession,
    *,
    session_name: str,
    condition: str,
    cue_enabled: bool,
    participant_id: str,
    state: Mapping[str, Any],
    ranking_move_id: int | None,
    ranking_item_catalog: list[dict[str, Any]] | None = None,
) -> RankingPhaseSnapshot:
    task_id = resolve_task_id(session_name=session_name)
    normalized_condition, normalized_cue_enabled = _normalize_snapshot_condition(
        session_name=session_name,
        condition=condition,
        cue_enabled=cue_enabled,
    )
    ranking_state = _state_from_mapping(state, source="reflect_ranking_move", ranking_move_id=ranking_move_id)
    snapshot = await _create_ranking_snapshot(
        db,
        session_name=session_name,
        task_id=task_id,
        condition=normalized_condition,
        cue_enabled=normalized_cue_enabled,
        phase="reflect",
        scope="private",
        subject_type="participant",
        subject_id=participant_id,
        participant_id=participant_id,
        group_id=session_name,
        source=ranking_state.source,
        source_phase="reflect",
        next_phase=None,
        revision=ranking_state.revision,
        change_count=ranking_state.change_count,
        ranking_move_id=ranking_state.ranking_move_id,
        ordered_items=_items_for_ranking_order(
            ranking_state.items,
            _ranking_item_catalog_by_id(
                session_name=session_name,
                task_id=task_id,
                ranking_item_catalog=ranking_item_catalog,
            ),
        ),
    )
    await db.commit()
    return snapshot


async def list_ranking_phase_snapshots(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str | None = None,
    phase: str | None = None,
    scope: str | None = None,
    participant_id: str | None = None,
    subject_id: str | None = None,
    limit: int = 200,
) -> list[RankingPhaseSnapshot]:
    resolved_task_id = resolve_task_id(session_name=session_name, task_id=task_id)
    bounded_limit = min(max(limit, 1), MAX_SNAPSHOT_LIST_LIMIT)
    stmt = (
        select(RankingPhaseSnapshot)
        .options(selectinload(RankingPhaseSnapshot.items))
        .where(
            RankingPhaseSnapshot.session_name == session_name,
            RankingPhaseSnapshot.task_id == resolved_task_id,
        )
        .order_by(RankingPhaseSnapshot.created_at.desc(), RankingPhaseSnapshot.id.desc())
        .limit(bounded_limit)
    )
    normalized_phase = _normalize_snapshot_phase(phase)
    if normalized_phase is not None:
        stmt = stmt.where(RankingPhaseSnapshot.phase == normalized_phase)
    if scope is not None:
        stmt = stmt.where(RankingPhaseSnapshot.scope == scope)
    if participant_id is not None:
        stmt = stmt.where(RankingPhaseSnapshot.participant_id == participant_id)
    if subject_id is not None:
        stmt = stmt.where(RankingPhaseSnapshot.subject_id == subject_id)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _snapshot_private_phase_task_items(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    phase: str,
    next_phase: str,
    condition: str,
    cue_enabled: bool,
    participant_ids: list[str],
) -> list[RankingPhaseSnapshot]:
    items_by_participant = await _load_private_phase_task_items_by_participant(
        db,
        session_name=session_name,
        task_id=task_id,
        participant_ids=participant_ids,
    )
    snapshots: list[RankingPhaseSnapshot] = []
    for participant_id, items in sorted(items_by_participant.items(), key=lambda entry: _participant_sort_key(entry[0])):
        ordered_items = [
            RankingSnapshotItemInput(
                item_id=f"{PRIVATE_PHASE_TASK_ITEM_ID_PREFIX}{item.id}",
                label=item.statement,
                source_metadata={
                    "private_phase_task_item_id": item.id,
                    "component_id": item.component_id,
                    "component_label": item.component_label,
                    "action_id": item.action_id,
                    "action_label": item.action_label,
                    "detail": item.detail,
                    "statement": item.statement,
                    "priority": item.priority,
                    "created_at": _isoformat(item.created_at),
                    "updated_at": _isoformat(item.updated_at),
                },
            )
            for item in items
        ]
        snapshots.append(
            await _create_ranking_snapshot(
                db,
                session_name=session_name,
                task_id=task_id,
                condition=condition,
                cue_enabled=cue_enabled,
                phase=phase,
                scope="private",
                subject_type="participant",
                subject_id=participant_id,
                participant_id=participant_id,
                group_id=session_name,
                source="private_phase_task_items",
                source_phase=phase,
                next_phase=next_phase,
                revision=0,
                change_count=None,
                ranking_move_id=None,
                ordered_items=ordered_items,
            )
        )
    return snapshots


async def _create_ranking_snapshot(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    condition: str,
    cue_enabled: bool,
    phase: str,
    scope: str,
    subject_type: str,
    subject_id: str,
    participant_id: str | None,
    group_id: str,
    source: str,
    source_phase: str | None,
    next_phase: str | None,
    revision: int,
    change_count: int | None,
    ranking_move_id: int | None,
    ordered_items: list[RankingSnapshotItemInput],
) -> RankingPhaseSnapshot:
    snapshot = RankingPhaseSnapshot(
        session_name=session_name,
        task_id=task_id,
        condition=condition,
        cue_enabled=cue_enabled,
        phase=phase,
        scope=scope,
        subject_type=subject_type,
        subject_id=subject_id,
        participant_id=participant_id,
        group_id=group_id,
        source=source,
        source_phase=source_phase,
        next_phase=next_phase,
        revision=revision,
        change_count=change_count,
        ranking_move_id=ranking_move_id,
        item_count=len(ordered_items),
    )
    db.add(snapshot)
    await db.flush()
    for position, item in enumerate(ordered_items, start=1):
        db.add(
            RankingPhaseSnapshotItem(
                snapshot_id=snapshot.id,
                item_id=item.item_id,
                position=position,
                label=item.label,
                source_metadata=item.source_metadata or {},
            )
        )
    return snapshot


async def _resolve_private_ranking_state(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    participant_id: str,
    phase: str,
    private_ranking_states: Mapping[str, Mapping[str, Any]] | None,
) -> RankingStateSnapshotInput:
    state = private_ranking_states.get(participant_id) if private_ranking_states else None
    if state is not None:
        return _state_from_mapping(state, source="memory")

    latest_move = await _get_latest_ranking_move(
        db,
        session_name=session_name,
        scope="private",
        participant_id=participant_id,
    )
    if latest_move is not None:
        return _state_from_ranking_move(latest_move)

    return RankingStateSnapshotInput(
        revision=0,
        items=await _default_private_ranking_items(
            db,
            session_name=session_name,
            task_id=task_id,
            participant_id=participant_id,
            phase=phase,
        ),
        source="default",
    )


async def _resolve_public_ranking_state(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    phase: str,
    public_ranking_state: Mapping[str, Any] | None,
    should_capture_default: bool,
) -> RankingStateSnapshotInput | None:
    if public_ranking_state is not None:
        state = _state_from_mapping(public_ranking_state, source="memory")
        if should_capture_default or state.revision > 0:
            return state

    latest_move = await _get_latest_ranking_move(
        db,
        session_name=session_name,
        scope="public",
        participant_id=None,
    )
    if latest_move is not None:
        return _state_from_ranking_move(latest_move)
    if not should_capture_default:
        return None

    return RankingStateSnapshotInput(
        revision=0,
        items=await _default_public_ranking_items(
            db,
            session_name=session_name,
            task_id=task_id,
            phase=phase,
        ),
        source="default",
    )


async def _get_latest_ranking_move(
    db: AsyncSession,
    *,
    session_name: str,
    scope: str,
    participant_id: str | None,
) -> RankingMove | None:
    stmt = (
        select(RankingMove)
        .where(
            RankingMove.session_name == session_name,
            RankingMove.scope == scope,
        )
        .order_by(RankingMove.time_stamp.desc(), RankingMove.id.desc())
        .limit(1)
    )
    if participant_id is not None:
        stmt = stmt.where(RankingMove.participant_id == participant_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _load_known_participant_ids(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    participant_ids: list[str],
) -> list[str]:
    known_ids = {str(value) for value in participant_ids if _is_participant_subject(value)}

    ranking_result = await db.execute(
        select(RankingMove.participant_id)
        .where(
            RankingMove.session_name == session_name,
            RankingMove.scope == "private",
        )
        .distinct()
    )
    known_ids.update(str(value) for value in ranking_result.scalars().all() if _is_participant_subject(value))

    task_item_result = await db.execute(
        select(PrivatePhaseTaskItem.user_id)
        .where(
            PrivatePhaseTaskItem.session_name == session_name,
            PrivatePhaseTaskItem.task_id == task_id,
        )
        .distinct()
    )
    known_ids.update(str(value) for value in task_item_result.scalars().all() if _is_participant_subject(str(value)))
    return sorted(known_ids, key=_participant_sort_key)


async def _load_private_phase_task_items_by_participant(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    participant_ids: list[str],
) -> dict[str, list[PrivatePhaseTaskItem]]:
    participant_user_ids = [_parse_int(value) for value in participant_ids]
    participant_user_ids = [value for value in participant_user_ids if value is not None]
    stmt = (
        select(PrivatePhaseTaskItem)
        .where(
            PrivatePhaseTaskItem.session_name == session_name,
            PrivatePhaseTaskItem.task_id == task_id,
        )
        .order_by(
            PrivatePhaseTaskItem.user_id.asc(),
            PrivatePhaseTaskItem.priority.asc(),
            PrivatePhaseTaskItem.id.asc(),
        )
    )
    if participant_user_ids:
        stmt = stmt.where(PrivatePhaseTaskItem.user_id.in_(participant_user_ids))
    result = await db.execute(stmt)
    grouped: dict[str, list[PrivatePhaseTaskItem]] = {}
    for item in result.scalars().all():
        grouped.setdefault(str(item.user_id), []).append(item)
    return grouped


async def _default_private_ranking_items(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    participant_id: str,
    phase: str,
) -> list[str]:
    if task_id == ENHANCE_THE_POSTER_TASK_ID and phase != PRIVATE_PHASE_1:
        snapshot = await get_phase_snapshot(
            db,
            session_name=session_name,
            task_id=task_id,
            to_phase=PRIVATE_PHASE_2,
        )
        if snapshot is not None:
            return build_private_phase_2_order(snapshot.items, participant_id)
    return get_ranking_items_for_session(session_name=session_name, task_id=task_id)


async def _default_public_ranking_items(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    phase: str,
) -> list[str]:
    if task_id == ENHANCE_THE_POSTER_TASK_ID and phase == GROUP_PHASE:
        snapshot = await get_phase_snapshot(
            db,
            session_name=session_name,
            task_id=task_id,
            to_phase=PRIVATE_PHASE_2,
        )
        if snapshot is not None:
            return stable_shuffle(
                [snapshot_item_id(item.id) for item in snapshot.items],
                f"{session_name}:{task_id}:{GROUP_PHASE}:{snapshot.id}",
            )
    return get_ranking_items_for_session(session_name=session_name, task_id=task_id)


def _state_from_mapping(
    state: Mapping[str, Any],
    *,
    source: str,
    ranking_move_id: int | None = None,
) -> RankingStateSnapshotInput:
    raw_items = state.get("items")
    items = list(raw_items) if isinstance(raw_items, list) else []
    real_items, change_count = split_ranking_items([str(item) for item in items])
    return RankingStateSnapshotInput(
        revision=_normalize_int(state.get("revision"), 0),
        items=real_items,
        change_count=change_count,
        ranking_move_id=ranking_move_id,
        source=source,
    )


def _state_from_ranking_move(ranking_move: RankingMove) -> RankingStateSnapshotInput:
    real_items, change_count = split_ranking_items([str(item) for item in ranking_move.items or []])
    return RankingStateSnapshotInput(
        revision=ranking_move.revision,
        items=real_items,
        change_count=change_count,
        ranking_move_id=ranking_move.id,
        source=f"ranking_move:{ranking_move.move_type}",
    )


def _items_for_ranking_order(
    item_ids: list[str],
    catalog_by_id: Mapping[str, dict[str, Any]],
) -> list[RankingSnapshotItemInput]:
    return [
        RankingSnapshotItemInput(
            item_id=item_id,
            label=_catalog_item_label(catalog_by_id.get(item_id)),
            source_metadata=_catalog_item_metadata(catalog_by_id.get(item_id)),
        )
        for item_id in item_ids
    ]


def _ranking_item_catalog_by_id(
    *,
    session_name: str,
    task_id: str,
    ranking_item_catalog: list[dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    catalog = ranking_item_catalog
    if not catalog:
        config = get_task_config_for_session(session_name=session_name, task_id=task_id)
        catalog = list(config.get("items") or [])
    return {str(item["id"]): dict(item) for item in catalog if isinstance(item, dict) and item.get("id")}


def _catalog_item_label(item: Mapping[str, Any] | None) -> str | None:
    if not item:
        return None
    for key in ("label", "label_zh", "label_en", "statement", "image_title"):
        value = item.get(key)
        if value:
            return str(value)
    return None


def _catalog_item_metadata(item: Mapping[str, Any] | None) -> dict[str, Any]:
    if not item:
        return {}
    return {str(key): _json_safe(value) for key, value in item.items()}


def _normalize_snapshot_condition(
    *,
    session_name: str,
    condition: str,
    cue_enabled: bool,
) -> tuple[str, bool]:
    session_key = session_name.lower().replace("_", "-")
    requested_condition = str(condition or "").strip().lower()
    if "no-cue" in session_key or requested_condition == "control":
        return "control", False
    if requested_condition in {"experimental", "with_cue", "with-cue"}:
        return "experimental", bool(cue_enabled)
    return "experimental", bool(cue_enabled)


def _normalize_snapshot_phase(value: str | None) -> str | None:
    if value is None:
        return None
    phase = value.strip().lower().replace("-", "_").replace(" ", "_")
    while "__" in phase:
        phase = phase.replace("__", "_")
    return {
        "public": GROUP_PHASE,
        "public_phase": GROUP_PHASE,
        "group_phase": GROUP_PHASE,
        "reflection": "reflect",
        "reflection_phase": "reflect",
        "reflect_phase": "reflect",
        "private_1": PRIVATE_PHASE_1,
        "private_phase_one": PRIVATE_PHASE_1,
        "private_2": PRIVATE_PHASE_2,
        "private_phase_two": PRIVATE_PHASE_2,
    }.get(phase, phase or None)


def _is_participant_subject(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    normalized = text.lower()
    return normalized != "admin" and not normalized.startswith("admin-")


def _participant_sort_key(value: str) -> tuple[int, int | str]:
    parsed = _parse_int(value)
    if parsed is not None:
        return (0, parsed)
    return (1, value)


def _parse_int(value: Any) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _normalize_int(value: Any, fallback: int) -> int:
    parsed = _parse_int(value)
    return parsed if parsed is not None else fallback


def _isoformat(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(inner_value) for key, inner_value in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value
