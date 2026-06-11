from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock, SimilarityCueEvent
from ..task_config import resolve_task_id
from ..utils import utc_now

DELIVERY_STATUSES = {"pending", "delivered", "failed", "suppressed", "unknown"}
RESPONSE_STATUSES = {"shown", "accepted", "ignored", "dismissed", "shared", "failed", "unknown"}


async def record_similarity_cue_delivery(
    db: AsyncSession,
    *,
    cue_id: str,
    session_name: str,
    phase: str,
    condition: str,
    cue_enabled: bool,
    recipient_participant_id: str,
    own_block: IdeaBlock,
    other_block: IdeaBlock,
    similarity_id: int,
    is_same_reason: bool,
    reason: str,
    delivery_status: str,
    event_metadata: dict[str, Any] | None = None,
) -> SimilarityCueEvent:
    return await upsert_similarity_cue_event(
        db,
        cue_id=cue_id,
        event_type="similarity_cue",
        source="similarity_pair",
        session_name=session_name,
        phase=phase,
        condition=condition,
        cue_enabled=cue_enabled,
        recipient_participant_id=recipient_participant_id,
        own_idea_block_id=own_block.id,
        other_idea_block_id=other_block.id,
        similarity_id=similarity_id,
        is_same_reason=is_same_reason,
        reason=reason,
        delivery_status=delivery_status,
        event_metadata=event_metadata,
    )


async def record_similarity_reason_share_delivery(
    db: AsyncSession,
    *,
    cue_id: str,
    session_name: str,
    phase: str,
    condition: str,
    cue_enabled: bool,
    sender_participant_id: str,
    recipient_participant_id: str,
    sender_idea_block_id: int,
    recipient_idea_block_id: int,
    similarity_id: int,
    is_same_reason: bool,
    reason: str,
    delivery_status: str,
    event_metadata: dict[str, Any] | None = None,
) -> SimilarityCueEvent:
    return await upsert_similarity_cue_event(
        db,
        cue_id=cue_id,
        event_type="similarity_reason_share",
        source="participant_share",
        session_name=session_name,
        phase=phase,
        condition=condition,
        cue_enabled=cue_enabled,
        sender_participant_id=sender_participant_id,
        recipient_participant_id=recipient_participant_id,
        own_idea_block_id=recipient_idea_block_id,
        other_idea_block_id=sender_idea_block_id,
        similarity_id=similarity_id,
        is_same_reason=is_same_reason,
        reason=reason,
        delivery_status=delivery_status,
        event_metadata=event_metadata,
    )


async def upsert_similarity_cue_event(
    db: AsyncSession,
    *,
    cue_id: str,
    event_type: str,
    source: str,
    session_name: str,
    phase: str,
    condition: str,
    cue_enabled: bool,
    recipient_participant_id: str,
    own_idea_block_id: int | None = None,
    other_idea_block_id: int | None = None,
    similarity_id: int | None = None,
    is_same_reason: bool | None = None,
    reason: str = "",
    delivery_status: str = "pending",
    sender_participant_id: str | None = None,
    event_metadata: dict[str, Any] | None = None,
) -> SimilarityCueEvent:
    normalized_cue_id = str(cue_id or "").strip()
    if not normalized_cue_id:
        normalized_cue_id = _fallback_cue_id(
            session_name=session_name,
            recipient_participant_id=recipient_participant_id,
            own_idea_block_id=own_idea_block_id,
            other_idea_block_id=other_idea_block_id,
            similarity_id=similarity_id,
        )
    event = await _get_event_by_cue_id(db, session_name=session_name, cue_id=normalized_cue_id)
    now = utc_now()
    normalized_delivery_status = _normalize_delivery_status(delivery_status)
    if event is None:
        event = SimilarityCueEvent(
            cue_id=normalized_cue_id,
            event_type=_clean_token(event_type, default="similarity_cue"),
            source=_clean_token(source, default="similarity_pair"),
            session_name=session_name,
            task_id=resolve_task_id(session_name=session_name),
            group_id=_resolve_group_id(session_name=session_name),
            condition=_normalize_condition(condition),
            cue_enabled=bool(cue_enabled),
            phase=_clean_token(phase, default="unknown"),
            cue_type=_cue_type(is_same_reason),
            sender_participant_id=_optional_participant_id(sender_participant_id),
            recipient_participant_id=str(recipient_participant_id),
            similarity_id=similarity_id,
            own_idea_block_id=own_idea_block_id,
            other_idea_block_id=other_idea_block_id,
            reason=reason or "",
            delivery_status=normalized_delivery_status,
            delivered_at=now if normalized_delivery_status == "delivered" else None,
            event_metadata=dict(event_metadata or {}),
            updated_at=now,
        )
        db.add(event)
    else:
        event.event_type = _clean_token(event_type, default=event.event_type)
        event.source = _clean_token(source, default=event.source)
        event.task_id = resolve_task_id(session_name=session_name)
        event.group_id = _resolve_group_id(session_name=session_name)
        event.condition = _normalize_condition(condition)
        event.cue_enabled = bool(cue_enabled)
        event.phase = _clean_token(phase, default=event.phase or "unknown")
        event.cue_type = _cue_type(is_same_reason)
        event.sender_participant_id = _optional_participant_id(sender_participant_id)
        event.recipient_participant_id = str(recipient_participant_id)
        event.similarity_id = similarity_id if similarity_id is not None else event.similarity_id
        event.own_idea_block_id = own_idea_block_id if own_idea_block_id is not None else event.own_idea_block_id
        event.other_idea_block_id = other_idea_block_id if other_idea_block_id is not None else event.other_idea_block_id
        event.reason = reason or event.reason or ""
        event.delivery_status = normalized_delivery_status
        if normalized_delivery_status == "delivered" and event.delivered_at is None:
            event.delivered_at = now
        event.event_metadata = _merge_metadata(event.event_metadata, event_metadata)
        event.updated_at = now

    await db.commit()
    await db.refresh(event)
    return event


async def record_similarity_cue_response(
    db: AsyncSession,
    *,
    session_name: str,
    participant_id: str,
    cue_id: str | None,
    response_status: str,
    timestamp_ms: int | None = None,
    phase: str = "unknown",
    condition: str = "experimental",
    cue_enabled: bool = True,
    block_id: int | None = None,
    event_metadata: dict[str, Any] | None = None,
) -> SimilarityCueEvent:
    event = await _get_event_by_cue_id(db, session_name=session_name, cue_id=str(cue_id or ""))
    if event is None:
        event = await upsert_similarity_cue_event(
            db,
            cue_id=cue_id or "",
            event_type="cue_response",
            source="participant_response",
            session_name=session_name,
            phase=phase,
            condition=condition,
            cue_enabled=cue_enabled,
            recipient_participant_id=str(participant_id),
            own_idea_block_id=block_id,
            delivery_status="unknown",
            event_metadata=event_metadata,
        )
    timestamp = _timestamp_from_ms(timestamp_ms)
    normalized_status = _normalize_response_status(response_status)
    _apply_response_status(event, normalized_status, timestamp)
    event.recipient_participant_id = str(participant_id)
    event.phase = _clean_token(phase, default=event.phase or "unknown")
    event.condition = _normalize_condition(condition)
    event.cue_enabled = bool(cue_enabled)
    event.event_metadata = _merge_metadata(event.event_metadata, event_metadata)
    event.updated_at = utc_now()
    await db.commit()
    await db.refresh(event)
    return event


async def mark_latest_similarity_cue_shared(
    db: AsyncSession,
    *,
    session_name: str,
    participant_id: str,
    cue_id: str | None = None,
    own_idea_block_id: int | None = None,
    phase: str = "unknown",
    condition: str = "experimental",
    cue_enabled: bool = True,
    timestamp_ms: int | None = None,
    event_metadata: dict[str, Any] | None = None,
) -> SimilarityCueEvent | None:
    event = await _get_event_by_cue_id(db, session_name=session_name, cue_id=str(cue_id or ""))
    if event is None and own_idea_block_id is not None:
        result = await db.execute(
            select(SimilarityCueEvent)
            .where(
                SimilarityCueEvent.session_name == session_name,
                SimilarityCueEvent.recipient_participant_id == str(participant_id),
                SimilarityCueEvent.own_idea_block_id == own_idea_block_id,
                SimilarityCueEvent.event_type == "similarity_cue",
            )
            .order_by(SimilarityCueEvent.created_at.desc(), SimilarityCueEvent.id.desc())
            .limit(1)
        )
        event = result.scalar_one_or_none()
    if event is None:
        return None

    timestamp = _timestamp_from_ms(timestamp_ms)
    _apply_response_status(event, "shared", timestamp)
    event.phase = _clean_token(phase, default=event.phase or "unknown")
    event.condition = _normalize_condition(condition)
    event.cue_enabled = bool(cue_enabled)
    event.event_metadata = _merge_metadata(event.event_metadata, event_metadata)
    event.updated_at = utc_now()
    await db.commit()
    await db.refresh(event)
    return event


async def safe_record_similarity_cue_response(db: AsyncSession, **kwargs: Any) -> SimilarityCueEvent | None:
    try:
        return await record_similarity_cue_response(db, **kwargs)
    except Exception as exc:
        await db.rollback()
        logger.warning("similarity_cue_response_persist_failed cue_id=%s error=%s", kwargs.get("cue_id"), exc)
        return None


def _apply_response_status(event: SimilarityCueEvent, status: str, timestamp: datetime) -> None:
    if status == "shown":
        event.shown_at = event.shown_at or timestamp
        if not event.response_status:
            event.response_status = "shown"
        return

    event.response_status = status
    event.responded_at = timestamp
    if status == "accepted":
        event.accepted_at = timestamp
    elif status == "ignored":
        event.ignored_at = timestamp
    elif status == "dismissed":
        event.dismissed_at = timestamp
    elif status == "shared":
        event.shared_at = timestamp


async def _get_event_by_cue_id(db: AsyncSession, *, session_name: str, cue_id: str) -> SimilarityCueEvent | None:
    normalized_cue_id = str(cue_id or "").strip()
    if not normalized_cue_id:
        return None
    result = await db.execute(
        select(SimilarityCueEvent).where(
            SimilarityCueEvent.session_name == session_name,
            SimilarityCueEvent.cue_id == normalized_cue_id,
        )
    )
    return result.scalar_one_or_none()


def _normalize_delivery_status(value: str | None) -> str:
    normalized = _clean_token(value, default="pending")
    return normalized if normalized in DELIVERY_STATUSES else "unknown"


def _normalize_response_status(value: str | None) -> str:
    normalized = _clean_token(value, default="unknown")
    aliases = {
        "view": "accepted",
        "viewed": "accepted",
        "accept": "accepted",
        "auto_dismissed": "ignored",
        "auto_dismiss": "ignored",
        "share": "shared",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in RESPONSE_STATUSES else "unknown"


def _normalize_condition(value: str | None) -> str:
    normalized = _clean_token(value, default="experimental")
    return normalized if normalized in {"experimental", "control"} else "experimental"


def _clean_token(value: Any, *, default: str) -> str:
    token = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    token = re.sub(r"[^a-z0-9_]+", "_", token)
    token = re.sub(r"_+", "_", token).strip("_")
    return token or default


def _optional_participant_id(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _cue_type(is_same_reason: bool | None) -> str:
    if is_same_reason is False:
        return "different_reason"
    return "same_reason"


def _timestamp_from_ms(timestamp_ms: int | None) -> datetime:
    if timestamp_ms is None:
        return utc_now()
    try:
        return datetime.fromtimestamp(int(timestamp_ms) / 1000, tz=timezone.utc)
    except (TypeError, ValueError, OSError, OverflowError):
        return utc_now()


def _resolve_group_id(*, session_name: str) -> str:
    match = re.search(r"(?i)(?:^|[^a-z0-9])(G\d{1,3})(?:[^a-z0-9]|$)", session_name)
    if match:
        return match.group(1).upper()
    task_id = resolve_task_id(session_name=session_name)
    suffix = re.sub(rf"^{re.escape(task_id)}[-_]*", "", session_name, flags=re.IGNORECASE)
    return suffix.strip("-_") or session_name


def _fallback_cue_id(
    *,
    session_name: str,
    recipient_participant_id: str,
    own_idea_block_id: int | None,
    other_idea_block_id: int | None,
    similarity_id: int | None,
) -> str:
    values = [
        session_name,
        str(recipient_participant_id),
        str(own_idea_block_id or ""),
        str(other_idea_block_id or ""),
        str(similarity_id or ""),
        str(int(utc_now().timestamp() * 1000)),
    ]
    return "cue:" + ":".join(values)


def _merge_metadata(current: dict[str, Any] | None, update: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(current or {})
    merged.update(update or {})
    return merged
