import hashlib
import random
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import logger
from ..models import PhaseTaskItemSnapshot, PhaseTaskItemSnapshotItem, PrivatePhaseTaskItem
from ..task_config import resolve_task_id

ENHANCE_THE_POSTER_TASK_ID = "enhance-the-poster"
PRIVATE_PHASE_1 = "private_phase_1"
PRIVATE_PHASE_2 = "private_phase_2"
GROUP_PHASE = "group"
SNAPSHOT_ITEM_ID_PREFIX = "snapshot-item:"


@dataclass(frozen=True)
class RankingInitialization:
    ranking_items: list[dict[str, Any]]
    public_items: list[str] | None = None
    private_items_by_participant_id: dict[str, list[str]] | None = None


def is_snapshot_task(session_name: str) -> bool:
    return resolve_task_id(session_name=session_name) == ENHANCE_THE_POSTER_TASK_ID


def snapshot_item_id(item_id: int) -> str:
    return f"{SNAPSHOT_ITEM_ID_PREFIX}{item_id}"


async def initialize_phase_rankings(
    db: AsyncSession,
    *,
    session_name: str,
    from_phase: str,
    to_phase: str,
    participant_ids: list[str],
) -> RankingInitialization | None:
    task_id = resolve_task_id(session_name=session_name)
    if task_id != ENHANCE_THE_POSTER_TASK_ID:
        logger.info(
            "phase_snapshot_skip_non_poster_task session_name=%s task_id=%s from_phase=%s to_phase=%s",
            session_name,
            task_id,
            from_phase,
            to_phase,
        )
        return None
    if to_phase not in {PRIVATE_PHASE_2, GROUP_PHASE}:
        logger.info(
            "phase_snapshot_skip_unsupported_phase session_name=%s task_id=%s from_phase=%s to_phase=%s",
            session_name,
            task_id,
            from_phase,
            to_phase,
        )
        return None

    snapshot = await get_or_create_phase_snapshot(
        db,
        session_name=session_name,
        task_id=task_id,
        from_phase=from_phase,
        to_phase=PRIVATE_PHASE_2,
        force_new=to_phase == PRIVATE_PHASE_2 and from_phase == PRIVATE_PHASE_1,
    )
    ranking_items = serialize_snapshot_ranking_items(snapshot.items)
    logger.info(
        "phase_snapshot_loaded session_name=%s task_id=%s snapshot_id=%s to_phase=%s ranking_item_count=%s participant_count=%s",
        session_name,
        task_id,
        snapshot.id,
        to_phase,
        len(ranking_items),
        len(participant_ids),
    )

    if to_phase == PRIVATE_PHASE_2:
        private_items_by_participant_id = {
            participant_id: build_private_phase_2_order(snapshot.items, participant_id)
            for participant_id in participant_ids
        }
        logger.info(
            "phase_snapshot_private_rankings_initialized session_name=%s snapshot_id=%s rankings=%s",
            session_name,
            snapshot.id,
            {
                participant_id: item_ids[:6]
                for participant_id, item_ids in private_items_by_participant_id.items()
            },
        )
        return RankingInitialization(
            ranking_items=ranking_items,
            private_items_by_participant_id=private_items_by_participant_id,
        )

    public_items = stable_shuffle(
        [snapshot_item_id(item.id) for item in snapshot.items],
        f"{session_name}:{task_id}:{GROUP_PHASE}:{snapshot.id}",
    )
    logger.info(
        "phase_snapshot_public_ranking_initialized session_name=%s snapshot_id=%s item_count=%s first_items=%s",
        session_name,
        snapshot.id,
        len(public_items),
        public_items[:8],
    )
    return RankingInitialization(
        ranking_items=ranking_items,
        public_items=public_items,
    )


async def get_or_create_phase_snapshot(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    from_phase: str,
    to_phase: str,
    force_new: bool = False,
) -> PhaseTaskItemSnapshot:
    if not force_new:
        existing = await get_phase_snapshot(
            db,
            session_name=session_name,
            task_id=task_id,
            to_phase=to_phase,
        )
        if existing is not None:
            logger.info(
                "phase_snapshot_reuse session_name=%s task_id=%s snapshot_id=%s to_phase=%s item_count=%s",
                session_name,
                task_id,
                existing.id,
                to_phase,
                len(existing.items),
            )
            return existing

    snapshot = PhaseTaskItemSnapshot(
        session_name=session_name,
        task_id=task_id,
        from_phase=from_phase,
        to_phase=to_phase,
        shuffle_seed=f"{session_name}:{task_id}:{to_phase}",
    )
    db.add(snapshot)
    await db.flush()

    source_items = await load_private_phase_items(db, session_name=session_name, task_id=task_id)
    deduplicated_items = deduplicate_private_phase_items(source_items)
    logger.info(
        "phase_snapshot_create_start session_name=%s task_id=%s from_phase=%s to_phase=%s snapshot_id=%s source_item_count=%s deduped_count=%s",
        session_name,
        task_id,
        from_phase,
        to_phase,
        snapshot.id,
        len(source_items),
        len(deduplicated_items),
    )
    for position, item in enumerate(deduplicated_items, start=1):
        source_priorities = [
            {"user_id": source.user_id, "priority": source.priority, "private_phase_task_item_id": source.id}
            for source in source_items
            if source.component_id == item.component_id and source.action_id == item.action_id
        ]
        source_user_ids = sorted({int(source["user_id"]) for source in source_priorities})
        db.add(
            PhaseTaskItemSnapshotItem(
                snapshot_id=snapshot.id,
                representative_private_phase_task_item_id=item.id,
                component_id=item.component_id,
                component_label=item.component_label,
                action_id=item.action_id,
                action_label=item.action_label,
                statement=item.statement,
                source_user_ids=source_user_ids,
                source_priorities=source_priorities,
                position=position,
            )
        )

    await db.commit()
    created = await get_phase_snapshot(db, session_name=session_name, task_id=task_id, to_phase=to_phase)
    if created is None:
        raise RuntimeError("phase task item snapshot was not created")
    logger.info(
        "phase_snapshot_created session_name=%s task_id=%s snapshot_id=%s to_phase=%s item_count=%s",
        session_name,
        task_id,
        created.id,
        to_phase,
        len(created.items),
    )
    return created


async def get_phase_snapshot(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    to_phase: str,
) -> PhaseTaskItemSnapshot | None:
    result = await db.execute(
        select(PhaseTaskItemSnapshot)
        .options(selectinload(PhaseTaskItemSnapshot.items))
        .where(
            PhaseTaskItemSnapshot.session_name == session_name,
            PhaseTaskItemSnapshot.task_id == task_id,
            PhaseTaskItemSnapshot.to_phase == to_phase,
        )
        .order_by(PhaseTaskItemSnapshot.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def load_private_phase_items(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
) -> list[PrivatePhaseTaskItem]:
    result = await db.execute(
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
    grouped: dict[int, list[PrivatePhaseTaskItem]] = defaultdict(list)
    for item in result.scalars().all():
        grouped[item.user_id].append(item)
    logger.info(
        "phase_snapshot_source_items_loaded session_name=%s task_id=%s users=%s total_selected=%s",
        session_name,
        task_id,
        {str(user_id): [item.id for item in items] for user_id, items in grouped.items()},
        sum(len(items) for items in grouped.values()),
    )
    return [item for user_items in grouped.values() for item in user_items]


def deduplicate_private_phase_items(items: list[PrivatePhaseTaskItem]) -> list[PrivatePhaseTaskItem]:
    seen: set[tuple[str, str]] = set()
    deduplicated: list[PrivatePhaseTaskItem] = []
    for item in items:
        key = (item.component_id, item.action_id)
        if key in seen:
            logger.info(
                "phase_snapshot_dedupe_drop private_phase_task_item_id=%s component_id=%s action_id=%s user_id=%s priority=%s",
                item.id,
                item.component_id,
                item.action_id,
                item.user_id,
                item.priority,
            )
            continue
        seen.add(key)
        deduplicated.append(item)
    return deduplicated


def build_private_phase_2_order(items: list[PhaseTaskItemSnapshotItem], participant_id: str) -> list[str]:
    try:
        user_id = int(participant_id)
    except ValueError:
        user_id = -1

    own_items = [
        item
        for item in items
        if user_id in {int(source_user_id) for source_user_id in item.source_user_ids}
    ]
    own_items.sort(key=lambda item: (_source_priority_for_user(item, user_id), item.position, item.id))
    own_ids = [snapshot_item_id(item.id) for item in own_items]
    remaining_ids = [
        snapshot_item_id(item.id)
        for item in items
        if snapshot_item_id(item.id) not in own_ids
    ]
    return own_ids + stable_shuffle(remaining_ids, f"private:{participant_id}:{','.join(remaining_ids)}")


def _source_priority_for_user(item: PhaseTaskItemSnapshotItem, user_id: int) -> int:
    priorities = item.source_priorities if isinstance(item.source_priorities, list) else []
    for entry in priorities:
        if not isinstance(entry, dict):
            continue
        if int(entry.get("user_id", -1)) == user_id:
            return int(entry.get("priority", 9999))
    return 9999


def stable_shuffle(values: list[str], seed: str) -> list[str]:
    shuffled = list(values)
    seed_int = int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16)
    random.Random(seed_int).shuffle(shuffled)
    return shuffled


def serialize_snapshot_ranking_items(items: list[PhaseTaskItemSnapshotItem]) -> list[dict[str, Any]]:
    return [
        {
            "id": snapshot_item_id(item.id),
            "label": item.statement,
            "label_zh": item.statement,
            "label_en": item.statement,
            "description_zh": f"{item.component_label} / {item.action_label}",
            "aliases": [],
            "image_title": item.component_label,
            "image_bg": "#f8fafc",
            "image_fg": "#334155",
            "image_mark": item.component_id[:8].upper(),
            "component_id": item.component_id,
            "action_id": item.action_id,
            "source_user_ids": list(item.source_user_ids or []),
        }
        for item in sorted(items, key=lambda value: (value.position, value.id))
    ]
