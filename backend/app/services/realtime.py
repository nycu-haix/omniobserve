import asyncio
import hashlib
import json
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import or_, select
from starlette.websockets import WebSocketState

from ..config import STREAM_CHUNK_SAMPLES, logger
from ..db import SessionLocal
from ..models import IdeaBlock, Similarity, Visibility
from ..schemas import ChatMessageCreate
from ..task_config import (
    get_default_phase_for_session,
    get_ranking_limit_for_session,
    get_ranking_items_for_session,
    get_task_config_for_session,
    normalize_phase_for_session,
)
from ..utils import utc_now
from .asr import transcribe_ws_chunk
from .chat_message_service import create_chat_message
from .idea_blocks import generate_idea_blocks_from_stream_transcripts
from .participant_status import (
    get_participant_display_name,
    get_participant_presence,
    mark_audio_disconnected,
    update_participant_metadata,
    update_audio_status,
)
from .public_context_matching import (
    PublicContextMatch,
    find_public_context_component_matches,
    find_public_context_matches,
    find_public_context_task_item_matches,
)
from .phase_task_item_snapshot_service import initialize_phase_rankings
from .ranking_phase_snapshot_service import (
    create_phase_boundary_ranking_snapshots,
    create_reflect_ranking_move_snapshot,
)
from .ranking_move_service import create_ranking_checkpoint, create_ranking_move
from .ranking_cutoff import (
    build_ranking_items_with_cutoff,
    normalize_ranking_change_count,
    split_ranking_items,
)
from .ranking_state_query_service import get_effective_ranking_state
from .transcripts import save_ws_transcript_segment

DUPLICATE_CONNECTION_CLOSE_CODE = 1008
DUPLICATE_PARTICIPANT_MESSAGE = (
    "這個 participant ID 已經在此 session 中，不能重複進入。"
)
DUPLICATE_ADMIN_MESSAGE = "這個 admin 已經在此 session 中，不能重複進入。"
ADMIN_PARTICIPANT_ID = "admin"
ADMIN_PARTICIPANT_ID_PREFIX = f"{ADMIN_PARTICIPANT_ID}-"
PUBLIC_CONTEXT_MATCH_WINDOW_SEGMENTS = 4
PUBLIC_CONTEXT_MATCH_WINDOW_MAX_CHARS = 700
PUBLIC_CONTEXT_MATCH_DEBOUNCE_SECONDS = 0.75
_public_context_windows: dict[str, deque[str]] = defaultdict(
    lambda: deque(maxlen=PUBLIC_CONTEXT_MATCH_WINDOW_SEGMENTS)
)
_public_context_matching_tasks: dict[str, asyncio.Task[None]] = {}


def _is_admin_participant_id(participant_id: str | None) -> bool:
    normalized_id = str(participant_id or "").lower()
    return normalized_id == ADMIN_PARTICIPANT_ID or normalized_id.startswith(
        ADMIN_PARTICIPANT_ID_PREFIX
    )


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[str, dict[str, WebSocket]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(
        self,
        session_id: str,
        participant_id: str,
        websocket: WebSocket,
        *,
        reject_duplicate: bool = True,
        duplicate_message: str = DUPLICATE_PARTICIPANT_MESSAGE,
        duplicate_error_code: str = "DUPLICATE_PARTICIPANT",
    ) -> bool:
        await websocket.accept()
        async with self._lock:
            previous = self.connections[session_id].get(participant_id)
            if previous and previous.client_state == WebSocketState.CONNECTED:
                if reject_duplicate:
                    await self._send_json_safely(
                        websocket,
                        {
                            "type": "join_rejected",
                            "error_code": duplicate_error_code,
                            "message": duplicate_message,
                            "session_name": session_id,
                            "participant_id": participant_id,
                        },
                    )
                    await self._close_safely(
                        websocket,
                        code=DUPLICATE_CONNECTION_CLOSE_CODE,
                        reason=duplicate_message,
                    )
                    return False
                await self._close_safely(previous, code=1000)
            self.connections[session_id][participant_id] = websocket
            return True

    async def disconnect(
        self, session_id: str, participant_id: str, websocket: WebSocket | None = None
    ) -> None:
        async with self._lock:
            participants = self.connections.get(session_id)
            if not participants:
                return
            current = participants.get(participant_id)
            if websocket is not None and current is not websocket:
                return
            participants.pop(participant_id, None)
            if not participants:
                self.connections.pop(session_id, None)

    async def send_to(
        self, session_id: str, participant_id: str, message: dict[str, Any]
    ) -> bool:
        websocket = self.connections.get(session_id, {}).get(participant_id)
        if websocket is None:
            return False
        return await self._send_json_safely(websocket, message)

    async def broadcast(
        self,
        session_id: str,
        message: dict[str, Any],
        *,
        exclude: set[str] | None = None,
    ) -> None:
        exclude = exclude or set()
        targets = [
            (participant_id, websocket)
            for participant_id, websocket in self.connections.get(
                session_id, {}
            ).items()
            if participant_id not in exclude
        ]
        disconnected: list[str] = []
        for participant_id, websocket in targets:
            sent = await self._send_json_safely(websocket, message)
            if not sent:
                disconnected.append(participant_id)
        for participant_id in disconnected:
            await self.disconnect(session_id, participant_id, websocket)

    def get_participants(self, session_id: str) -> list[str]:
        return sorted(self.connections.get(session_id, {}).keys())

    async def _send_json_safely(
        self, websocket: WebSocket, message: dict[str, Any]
    ) -> bool:
        if websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await websocket.send_json(message)
            return True
        except Exception as exc:
            logger.warning("Failed to send WebSocket payload: %s", exc)
            return False

    async def _close_safely(
        self, websocket: WebSocket, *, code: int, reason: str | None = None
    ) -> None:
        try:
            await websocket.close(code=code, reason=reason or "")
        except Exception:
            return


@dataclass
class AudioConnectionState:
    websocket: WebSocket
    sample_rate: int = 16000
    mic_mode: str = "private"
    display_name: str | None = None
    is_speaking: bool = False
    audio_buffer: bytearray = field(default_factory=bytearray)


audio_manager = ConnectionManager()
admin_manager = ConnectionManager()
board_manager = ConnectionManager()
cue_manager = ConnectionManager()
presence_manager = ConnectionManager()

audio_connections: dict[str, dict[str, AudioConnectionState]] = defaultdict(dict)
public_ranking_state: dict[str, dict[str, Any]] = {}
private_ranking_state: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
session_ranking_item_catalog: dict[str, list[dict[str, Any]]] = {}
session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
board_blocks: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
    lambda: {"public_blocks": [], "private_blocks": []}
)
cue_responses: dict[str, list[dict[str, Any]]] = defaultdict(list)
session_phases: dict[str, str] = {}
session_timers: dict[str, dict[str, Any]] = defaultdict(
    lambda: {"end_time_ms": 0, "duration_s": 0}
)
session_cue_conditions: dict[str, str] = defaultdict(lambda: "experimental")
session_public_context_state: dict[str, dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _get_session_phase(session_id: str) -> str:
    phase = session_phases.get(session_id)
    if phase is None:
        phase = get_default_phase_for_session(session_name=session_id)
        session_phases[session_id] = phase
    return phase


def _normalize_session_phase(session_id: str, value: Any) -> str:
    return normalize_phase_for_session(session_name=session_id, phase=value)


def _normalize_cue_condition(value: Any) -> str:
    condition = str(value or "experimental").lower()
    return condition if condition in {"experimental", "control"} else "experimental"


def is_similarity_cue_enabled(session_id: str) -> bool:
    return session_cue_conditions[session_id] == "experimental"


def _phase_state_message(session_id: str) -> dict[str, Any]:
    timer = session_timers[session_id]
    return {
        "current_phase": _get_session_phase(session_id),
        "timer_end_time_ms": timer["end_time_ms"],
        "duration_s": timer["duration_s"],
        "cue_condition": session_cue_conditions[session_id],
        "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
    }


def _set_session_countdown(session_id: str, duration_s: int) -> None:
    if duration_s > 0:
        session_timers[session_id] = {
            "end_time_ms": _now_ms() + duration_s * 1000,
            "duration_s": duration_s,
        }
    else:
        session_timers[session_id] = {"end_time_ms": 0, "duration_s": 0}


def _phase_changed_message(session_id: str) -> dict[str, Any]:
    timer = session_timers[session_id]
    return {
        "type": "phase_changed",
        "phase": _get_session_phase(session_id),
        "end_time_ms": timer["end_time_ms"],
        "duration_s": timer["duration_s"],
        "cue_condition": session_cue_conditions[session_id],
        "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
        "timestamp_ms": _now_ms(),
    }


def _public_context_component_state_message(session_id: str) -> dict[str, Any]:
    state = session_public_context_state.get(session_id) or {}
    component_ids = list(state.get("component_ids") or [])
    task_item_ids = list(state.get("task_item_ids") or [])
    return {
        "type": "public_context_component_state",
        "componentIds": component_ids,
        "component_ids": component_ids,
        "taskItemIds": task_item_ids,
        "task_item_ids": task_item_ids,
        "source": state.get("source"),
        "matchCount": _normalize_int(state.get("match_count"), 0),
        "match_count": _normalize_int(state.get("match_count"), 0),
        "deliveredCount": _normalize_int(state.get("delivered_count"), 0),
        "delivered_count": _normalize_int(state.get("delivered_count"), 0),
        "timestamp_ms": _normalize_int(state.get("timestamp_ms"), 0),
    }


def _countdown_changed_message(session_id: str) -> dict[str, Any]:
    timer = session_timers[session_id]
    return {
        "type": "countdown_changed",
        "current_phase": _get_session_phase(session_id),
        "timer_end_time_ms": timer["end_time_ms"],
        "end_time_ms": timer["end_time_ms"],
        "duration_s": timer["duration_s"],
        "cue_condition": session_cue_conditions[session_id],
        "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
        "timestamp_ms": _now_ms(),
    }


def _is_websocket_disconnect_runtime_error(exc: RuntimeError) -> bool:
    message = str(exc)
    return "WebSocket is not connected" in message or 'Cannot call "receive"' in message


async def broadcast_admin_transcript(
    session_id: str,
    *,
    participant_id: str,
    scope: str,
    text: str,
    is_final: bool,
    persisted: bool,
    transcript_segment_id: str | int | None = None,
    reason: str | None = None,
) -> None:
    await admin_manager.broadcast(
        session_id,
        {
            "type": "participant_transcript",
            "session_name": session_id,
            "participant_id": participant_id,
            "scope": scope,
            "text": text,
            "is_final": is_final,
            "persisted": persisted,
            "transcript_segment_id": transcript_segment_id,
            "reason": reason,
            "timestamp_ms": _now_ms(),
        },
    )


def _presence_state_message(session_id: str) -> dict[str, Any]:
    participant_ids = sorted(
        {
            *presence_manager.get_participants(session_id),
            *board_manager.get_participants(session_id),
        }
    )
    return {
        "type": "presence_state",
        "session_name": session_id,
        "participant_ids": participant_ids,
        "participants": get_participant_presence(session_id, participant_ids),
        "timestamp_ms": _now_ms(),
    }


async def broadcast_presence_state(session_id: str) -> None:
    await presence_manager.broadcast(session_id, _presence_state_message(session_id))
    await admin_manager.broadcast(session_id, _presence_state_message(session_id))


async def broadcast_admin_idea_blocks_update(
    session_id: str,
    *,
    participant_id: str,
    idea_blocks: list[dict[str, Any]],
) -> None:
    await admin_manager.broadcast(
        session_id,
        {
            "type": "idea_blocks_update",
            "session_name": session_id,
            "participant_id": participant_id,
            "idea_blocks": idea_blocks,
            "timestamp_ms": _now_ms(),
        },
    )


def _serialize_admin_idea_blocks(idea_blocks: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": block.id,
            "user_id": block.user_id,
            "title": block.title,
            "summary": block.summary,
            "time_stamp": block.time_stamp.isoformat() if block.time_stamp else None,
            "transcript_id": block.transcript_id,
            "transcript": block.transcript,
            "similarity_id": block.similarity_id,
            "similarity_is_same_reason": block.similarity_is_same_reason,
            "similarity_has_same_reason": block.similarity_has_same_reason,
            "similarity_has_different_reason": block.similarity_has_different_reason,
        }
        for block in idea_blocks
    ]


async def broadcast_public_transcript_line(
    session_id: str,
    *,
    participant_id: str,
    text: str,
    transcript_segment_id: str | int | None = None,
) -> None:
    display_name = get_participant_display_name(session_id, participant_id)
    await board_manager.broadcast(
        session_id,
        {
            "type": "new_transcript_line",
            "payload": {
                "id": str(transcript_segment_id)
                if transcript_segment_id is not None
                else f"public-{participant_id}-{_now_ms()}",
                "source": "public",
                "origin": "live",
                "userId": participant_id,
                "displayName": display_name,
                "timestampMs": _now_ms(),
                "text": text,
            },
        },
    )
    _schedule_public_context_matching(
        session_id=session_id,
        participant_id=participant_id,
        text=text,
        transcript_segment_id=transcript_segment_id,
    )


def _schedule_public_context_matching(
    *,
    session_id: str,
    participant_id: str,
    text: str,
    transcript_segment_id: str | int | None,
) -> None:
    if not text.strip():
        return
    match_text = _append_public_context_text(session_id, text)

    async def run_matching() -> None:
        try:
            await asyncio.sleep(PUBLIC_CONTEXT_MATCH_DEBOUNCE_SECONDS)
            async with SessionLocal() as db:
                matches = await find_public_context_matches(
                    db,
                    session_name=session_id,
                    public_text=match_text,
                )
            if not matches:
                return

            await _publish_public_context_matches(
                session_id,
                matches=matches,
                source="auto",
                participant_id=participant_id,
                transcript_segment_id=transcript_segment_id,
                text_chars=len(text),
                context_chars=len(match_text),
            )
        except asyncio.CancelledError:
            return
        except Exception as exc:
            logger.exception(
                "public_context_matching_failed session_id=%s participant_id=%s transcript_segment_id=%s error_type=%s error=%s",
                session_id,
                participant_id,
                transcript_segment_id,
                exc.__class__.__name__,
                exc,
            )
        finally:
            current_task = asyncio.current_task()
            if _public_context_matching_tasks.get(session_id) is current_task:
                _public_context_matching_tasks.pop(session_id, None)

    logger.info(
        "public_context_matching_scheduled session_id=%s participant_id=%s transcript_segment_id=%s text_chars=%s",
        session_id,
        participant_id,
        transcript_segment_id,
        len(text),
    )
    previous_task = _public_context_matching_tasks.get(session_id)
    if previous_task is not None and not previous_task.done():
        previous_task.cancel()
    _public_context_matching_tasks[session_id] = asyncio.create_task(run_matching())


async def _publish_public_context_matches(
    session_id: str,
    *,
    matches: list[PublicContextMatch],
    source: str,
    participant_id: str | None = None,
    transcript_segment_id: str | int | None = None,
    text_chars: int = 0,
    context_chars: int = 0,
    component_ids: list[str] | None = None,
    task_item_ids: list[int] | None = None,
) -> None:
    resolved_component_ids = _unique_strings(
        component_ids if component_ids is not None else [component_id for match in matches for component_id in match.component_ids]
    )
    resolved_task_item_ids = _unique_ints(
        task_item_ids if task_item_ids is not None else [task_item_id for match in matches for task_item_id in match.task_item_ids]
    )
    matches_by_user: dict[str, list[PublicContextMatch]] = {}
    for match in matches:
        matches_by_user.setdefault(str(match.user_id), []).append(match)

    delivered_count = 0
    target_participant_ids = [
        target_participant_id
        for target_participant_id in board_manager.get_participants(session_id)
        if not _is_admin_participant_id(target_participant_id)
    ]
    for target_participant_id in target_participant_ids:
        user_matches = matches_by_user.get(target_participant_id, [])
        sent = await board_manager.send_to(
            session_id,
            target_participant_id,
            {
                "type": "public_context_matches",
                "payload": {
                    "transcriptId": str(transcript_segment_id) if transcript_segment_id is not None else None,
                    "participantId": participant_id,
                    "textChars": text_chars,
                    "contextChars": context_chars,
                    "replaceExisting": True,
                    "pinMode": "public_context_topic",
                    "componentIds": resolved_component_ids,
                    "taskItemIds": resolved_task_item_ids,
                    "source": source,
                    "matches": [_public_context_match_payload(match) for match in user_matches],
                },
            },
        )
        if sent:
            delivered_count += 1

    timestamp_ms = _now_ms()
    session_public_context_state[session_id] = {
        "component_ids": resolved_component_ids,
        "task_item_ids": resolved_task_item_ids,
        "source": source,
        "match_count": len(matches),
        "delivered_count": delivered_count,
        "timestamp_ms": timestamp_ms,
    }
    await admin_manager.broadcast(session_id, _public_context_component_state_message(session_id))


def _public_context_match_payload(match: PublicContextMatch) -> dict[str, Any]:
    return {
        "ideaBlockId": str(match.idea_block_id),
        "userId": str(match.user_id),
        "score": match.score,
        "reason": match.reason,
        "taskItemIds": match.task_item_ids,
        "componentIds": match.component_ids,
    }


def _append_public_context_text(session_id: str, text: str) -> str:
    window = _public_context_windows[session_id]
    normalized_text = text.strip()
    window.append(normalized_text)

    selected: list[str] = []
    total_chars = 0
    for segment in reversed(window):
        segment_chars = len(segment)
        if selected and total_chars + segment_chars > PUBLIC_CONTEXT_MATCH_WINDOW_MAX_CHARS:
            break
        selected.append(segment)
        total_chars += segment_chars

    return "\n".join(reversed(selected))


def _normalize_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def _normalize_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    parsed = _normalize_int(value, -1)
    return parsed if parsed >= 0 else None


def _unique_strings(values: list[Any]) -> list[str]:
    normalized_values: list[str] = []
    seen_values: set[str] = set()
    for value in values:
        normalized_value = str(value or "").strip()
        if not normalized_value or normalized_value in seen_values:
            continue
        seen_values.add(normalized_value)
        normalized_values.append(normalized_value)
    return normalized_values


def _unique_ints(values: list[Any]) -> list[int]:
    normalized_values: list[int] = []
    seen_values: set[int] = set()
    for value in values:
        parsed_value = _normalize_optional_int(value)
        if parsed_value is None or parsed_value in seen_values:
            continue
        seen_values.add(parsed_value)
        normalized_values.append(parsed_value)
    return normalized_values


def _normalize_public_context_component_ids(session_id: str, value: Any) -> list[str]:
    if isinstance(value, str):
        raw_component_ids = [value]
    elif isinstance(value, list):
        raw_component_ids = value
    else:
        raw_component_ids = []

    task_config = get_task_config_for_session(session_name=session_id)
    builder = task_config.get("phase1_builder") or {}
    valid_component_ids = {str(item["id"]) for item in builder.get("components", []) if item.get("id")}
    return [component_id for component_id in _unique_strings(raw_component_ids) if component_id in valid_component_ids]


def _normalize_public_context_task_item_ids(session_id: str, value: Any) -> list[int]:
    if isinstance(value, (int, str)):
        raw_task_item_ids = [value]
    elif isinstance(value, list):
        raw_task_item_ids = value
    else:
        raw_task_item_ids = []

    ranking_items = get_ranking_items_for_session(session_name=session_id)
    task_item_id_by_config_id = {str(item_id): index for index, item_id in enumerate(ranking_items, start=1)}
    normalized_task_item_ids: list[int] = []
    seen_task_item_ids: set[int] = set()
    for raw_task_item_id in raw_task_item_ids:
        parsed_task_item_id: int | None = None
        if isinstance(raw_task_item_id, int):
            parsed_task_item_id = raw_task_item_id
        else:
            raw_text = str(raw_task_item_id or "").strip()
            if raw_text.isdigit():
                parsed_task_item_id = int(raw_text)
            else:
                parsed_task_item_id = task_item_id_by_config_id.get(raw_text)
        if parsed_task_item_id is None or parsed_task_item_id < 1 or parsed_task_item_id > len(ranking_items):
            continue
        if parsed_task_item_id in seen_task_item_ids:
            continue
        seen_task_item_ids.add(parsed_task_item_id)
        normalized_task_item_ids.append(parsed_task_item_id)
    return normalized_task_item_ids


def _chat_message_payload(chat_message: Any, client_message_id: str | None = None) -> dict[str, Any]:
    timestamp_ms = (
        int(chat_message.time_stamp.timestamp() * 1000)
        if chat_message.time_stamp
        else _now_ms()
    )
    payload = {
        "id": str(chat_message.id),
        "sessionName": chat_message.session_name,
        "userId": str(chat_message.user_id),
        "displayName": chat_message.display_name,
        "message": chat_message.message,
        "timestampMs": timestamp_ms,
        "isDeleted": chat_message.is_deleted,
    }
    if client_message_id:
        payload["clientMessageId"] = client_message_id
    return payload


def _public_chat_error_message(
    reason: str,
    client_message_id: str | None = None,
) -> dict[str, Any]:
    message: dict[str, Any] = {
        "type": "public_chat_error",
        "reason": reason,
    }
    if client_message_id:
        message["clientMessageId"] = client_message_id
    return message


async def _send_similarity_reason_share_error(
    session_id: str,
    participant_id: str,
    *,
    reason: str,
    block_id: int | None = None,
) -> None:
    message: dict[str, Any] = {
        "type": "similarity_reason_share_error",
        "reason": reason,
    }
    if block_id is not None and block_id >= 0:
        message["blockId"] = str(block_id)

    await board_manager.send_to(session_id, participant_id, message)


async def _handle_similarity_reason_share(
    session_id: str, participant_id: str, payload: dict[str, Any]
) -> None:
    block_id = _normalize_int(payload.get("blockId") or payload.get("block_id"), -1)
    if not is_similarity_cue_enabled(session_id):
        await _send_similarity_reason_share_error(
            session_id,
            participant_id,
            reason="similarity cues are disabled",
            block_id=block_id,
        )
        logger.info(
            "similarity_reason_share_suppressed session_id=%s participant_id=%s cue_condition=%s",
            session_id,
            participant_id,
            session_cue_conditions[session_id],
        )
        return

    participant_user_id = _normalize_int(participant_id, -1)
    if block_id < 0 or participant_user_id < 0:
        await _send_similarity_reason_share_error(
            session_id,
            participant_id,
            reason="invalid idea block",
            block_id=block_id,
        )
        return

    async with SessionLocal() as db:
        own_block = await db.get(IdeaBlock, block_id)
        if (
            own_block is None
            or own_block.is_deleted
            or own_block.session_name != session_id
            or own_block.user_id != participant_user_id
        ):
            await _send_similarity_reason_share_error(
                session_id,
                participant_id,
                reason="similar idea block not found",
                block_id=block_id,
            )
            return

        result = await db.execute(
            select(Similarity).where(
                or_(
                    Similarity.idea_block_id_1 == own_block.id,
                    Similarity.idea_block_id_2 == own_block.id,
                )
            )
        )
        similarities = result.scalars().all()
        targets: list[tuple[str, dict[str, Any], int, int]] = []
        received_at_ms = _now_ms()
        for similarity in similarities:
            other_block_id = (
                similarity.idea_block_id_2
                if similarity.idea_block_id_1 == own_block.id
                else similarity.idea_block_id_1
            )
            other_block = await db.get(IdeaBlock, other_block_id)
            if (
                other_block is None
                or other_block.is_deleted
                or other_block.session_name != session_id
                or other_block.user_id == own_block.user_id
            ):
                continue

            target_participant_id = str(other_block.user_id)
            targets.append(
                (
                    target_participant_id,
                    {
                        "type": "similarity_reason_shared",
                        "payload": {
                            "id": _anonymous_shared_reason_id(
                                session_id,
                                similarity.id,
                                other_block.id,
                            ),
                            "blockId": str(other_block.id),
                            "title": own_block.title,
                            "summary": own_block.summary,
                            "isSameReason": similarity.is_same_reason,
                            "receivedAtMs": received_at_ms,
                        },
                    },
                    similarity.id,
                    other_block.id,
                )
            )

        if not targets:
            await _send_similarity_reason_share_error(
                session_id,
                participant_id,
                reason="recipient idea blocks not found",
                block_id=own_block.id,
            )
            return

        own_block_id = own_block.id

    delivery_results = [
        (
            target_participant_id,
            similarity_id,
            target_block_id,
            await board_manager.send_to(session_id, target_participant_id, message),
        )
        for target_participant_id, message, similarity_id, target_block_id in targets
    ]
    delivered_count = sum(
        1
        for _, _, _, sent in delivery_results
        if sent
    )
    await board_manager.send_to(
        session_id,
        participant_id,
        {
            "type": "similarity_reason_share_sent",
            "payload": {
                "blockId": str(own_block_id),
                "recipientCount": len(delivery_results),
                "deliveredCount": delivered_count,
            },
        },
    )
    logger.info(
        "similarity_reason_shared session_id=%s from_participant_id=%s from_block_id=%s recipients=%s delivered_count=%s",
        session_id,
        participant_id,
        own_block_id,
        [
            {
                "target_participant_id": target_participant_id,
                "target_block_id": target_block_id,
                "similarity_id": similarity_id,
                "delivered": sent,
            }
            for target_participant_id, similarity_id, target_block_id, sent in delivery_results
        ],
        delivered_count,
    )


def _anonymous_shared_reason_id(session_id: str, similarity_id: int, target_block_id: int) -> str:
    digest = hashlib.sha256(
        f"{session_id}:{similarity_id}:{target_block_id}".encode("utf-8")
    ).hexdigest()
    return f"shared-reason-{digest[:16]}"


def _get_default_ranking_items(session_id: str) -> list[str]:
    return get_ranking_items_for_session(session_name=session_id)


def _get_current_ranking_items(session_id: str) -> list[str]:
    catalog = session_ranking_item_catalog.get(session_id)
    if catalog:
        return [str(item["id"]) for item in catalog if item.get("id")]
    return _get_default_ranking_items(session_id)


def _get_active_ranking_limit(session_id: str) -> int | None:
    return _get_ranking_limit_for_item_count(
        session_id,
        len(_get_current_ranking_items(session_id)),
    )


def _get_ranking_limit_for_item_count(session_id: str, item_count: int) -> int | None:
    ranking_limit = get_ranking_limit_for_session(session_name=session_id)
    if ranking_limit is None:
        return None
    return ranking_limit if item_count > 0 else None


def _build_internal_ranking_items_for_session(
    session_id: str,
    items: list[str],
    change_count: int | None = None,
) -> list[str]:
    ranking_limit = _get_ranking_limit_for_item_count(session_id, len(items))
    if ranking_limit is None:
        return list(items)
    return build_ranking_items_with_cutoff(
        items,
        normalize_ranking_change_count(
            change_count,
            ranking_limit=ranking_limit,
            item_count=len(items),
        ),
    )


def _get_current_ranking_item_catalog(session_id: str) -> list[dict[str, Any]] | None:
    catalog = session_ranking_item_catalog.get(session_id)
    return [dict(item) for item in catalog] if catalog else None


def _normalize_ranking_state(session_id: str, state: dict[str, Any]) -> dict[str, Any]:
    default_ranking_items = _get_current_ranking_items(session_id)
    default_ranking_item_set = set(default_ranking_items)
    current_items = state.get("items")
    if not isinstance(current_items, list):
        current_items = []
    current_real_items, current_change_count = split_ranking_items(current_items)
    seen_items: set[str] = set()
    normalized_real_items: list[str] = []
    for item in current_real_items:
        if item in default_ranking_item_set and item not in seen_items:
            normalized_real_items.append(item)
            seen_items.add(item)
    normalized_items = normalized_real_items
    normalized_items.extend(
        item for item in default_ranking_items if item not in normalized_items
    )
    ranking_limit = _get_ranking_limit_for_item_count(session_id, len(normalized_items))
    if ranking_limit is not None:
        normalized_change_count = normalize_ranking_change_count(
            current_change_count,
            ranking_limit=ranking_limit,
            item_count=len(normalized_items),
        )
        normalized_items = build_ranking_items_with_cutoff(
            normalized_items,
            normalized_change_count,
        )
    if normalized_items != current_items:
        state["items"] = normalized_items
        state["revision"] = _normalize_int(state.get("revision"), 0) + 1
    return state


def _create_ranking_state_from_items(
    session_id: str,
    items: list[str],
    *,
    revision: int = 0,
    change_count: int | None = None,
) -> dict[str, Any]:
    return {
        "revision": revision,
        "items": _build_internal_ranking_items_for_session(
            session_id,
            items,
            change_count=change_count,
        ),
    }


def _create_ranking_state(session_id: str) -> dict[str, Any]:
    return _create_ranking_state_from_items(session_id, _get_current_ranking_items(session_id))


def _get_public_ranking_state(session_id: str) -> dict[str, Any]:
    if session_id not in public_ranking_state:
        public_ranking_state[session_id] = _create_ranking_state(session_id)
    else:
        _normalize_ranking_state(session_id, public_ranking_state[session_id])
    return public_ranking_state[session_id]


def _get_private_ranking_state(session_id: str, participant_id: str) -> dict[str, Any]:
    if participant_id not in private_ranking_state[session_id]:
        private_ranking_state[session_id][participant_id] = _create_ranking_state(session_id)
    else:
        _normalize_ranking_state(session_id, private_ranking_state[session_id][participant_id])
    return private_ranking_state[session_id][participant_id]


def _get_ranking_state(
    session_id: str, participant_id: str, scope: str
) -> dict[str, Any]:
    if scope == "private":
        return _get_private_ranking_state(session_id, participant_id)
    return _get_public_ranking_state(session_id)


def _ranking_payload(session_id: str, state: dict[str, Any]) -> dict[str, Any]:
    items, change_count = split_ranking_items(state["items"])
    payload: dict[str, Any] = {
        "revision": state["revision"],
        "items": items,
    }
    ranking_limit = _get_active_ranking_limit(session_id)
    if ranking_limit is not None:
        payload["change_count"] = normalize_ranking_change_count(
            change_count,
            ranking_limit=ranking_limit,
            item_count=len(items),
        )
    return payload


def _normalize_ranking_scope(value: Any) -> str:
    return "private" if str(value).lower() == "private" else "public"


def _board_state_message(session_id: str, participant_id: str) -> dict[str, Any]:
    public_state = _get_public_ranking_state(session_id)
    private_state = _get_private_ranking_state(session_id, participant_id)
    blocks = board_blocks[session_id]
    private_blocks = [
        block
        for block in blocks["private_blocks"]
        if block.get("participant_id") == participant_id
    ]
    return {
        "type": "board_state",
        "session_name": session_id,
        "revision": public_state["revision"],
        "ranking": {"items": split_ranking_items(public_state["items"])[0]},
        "public_ranking": _ranking_payload(session_id, public_state),
        "private_ranking": _ranking_payload(session_id, private_state),
        "ranking_items": _get_current_ranking_item_catalog(session_id),
        "public_blocks": list(blocks["public_blocks"]),
        "private_blocks": private_blocks,
        "current_phase": _get_session_phase(session_id),
        "timer_end_time_ms": session_timers[session_id]["end_time_ms"],
        "cue_condition": session_cue_conditions[session_id],
        "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
    }


def _admin_ranking_state_message(session_id: str) -> dict[str, Any]:
    public_state = _get_public_ranking_state(session_id)
    private_rankings = {
        participant_id: _ranking_payload(session_id, state)
        for participant_id, state in sorted(private_ranking_state[session_id].items())
        if not _is_admin_participant_id(participant_id)
    }
    return {
        "type": "admin_ranking_state",
        "session_name": session_id,
        "revision": public_state["revision"],
        "public_ranking": _ranking_payload(session_id, public_state),
        "private_rankings": private_rankings,
        "ranking_items": _get_current_ranking_item_catalog(session_id),
    }


def _apply_ranking_move(items: list[str], item_id: str, to_index: int, *, ranking_limit: int | None = None) -> list[str]:
    real_items, change_count = split_ranking_items(items)
    if item_id not in real_items:
        raise ValueError("ranking item does not exist")
    old_index = real_items.index(item_id)
    target_index = max(0, min(to_index, len(real_items)))
    next_real_items = [item for item in real_items if item != item_id]
    insert_index = max(0, min(to_index, len(next_real_items)))
    next_real_items.insert(insert_index, item_id)

    next_change_count: int | None = None
    if ranking_limit is not None:
        current_change_count = normalize_ranking_change_count(
            change_count,
            ranking_limit=ranking_limit,
            item_count=len(real_items),
        )
        next_change_count = current_change_count
        if old_index < current_change_count and target_index >= current_change_count:
            next_change_count = max(0, current_change_count - 1)
        elif old_index >= current_change_count and target_index <= current_change_count:
            next_change_count = normalize_ranking_change_count(
                current_change_count + 1,
                ranking_limit=ranking_limit,
                item_count=len(real_items),
            )

    return build_ranking_items_with_cutoff(next_real_items, next_change_count)


async def handle_board_websocket(
    websocket: WebSocket, *, session_id: str, participant_id: str
) -> None:
    connected = await board_manager.connect(session_id, participant_id, websocket)
    if not connected:
        logger.info(
            "board ws duplicate rejected session_id=%s participant_id=%s",
            session_id,
            participant_id,
        )
        return
    logger.info(
        "board ws connected session_id=%s participant_id=%s participants=%s",
        session_id,
        participant_id,
        board_manager.get_participants(session_id),
    )
    await board_manager.send_to(
        session_id,
        participant_id,
        {
            "type": "joined",
            "session_name": session_id,
            "participant_id": participant_id,
        },
    )

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                payload = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            message_type = payload.get("type")

            if message_type == "join":
                display_name = (
                    str(
                        payload.get("displayName")
                        or payload.get("display_name")
                        or payload.get("name")
                        or ""
                    ).strip()
                    or None
                )
                client_id = (
                    str(payload.get("clientId") or payload.get("client_id") or "").strip()
                    or None
                )
                update_participant_metadata(
                    session_id,
                    participant_id,
                    display_name=display_name,
                    client_id=client_id,
                )
                logger.info(
                    "board ws join session_id=%s participant_id=%s",
                    session_id,
                    participant_id,
                )
                await board_manager.send_to(
                    session_id,
                    participant_id,
                    _board_state_message(session_id, participant_id),
                )
                await broadcast_presence_state(session_id)
                continue

            if message_type == "ping":
                await board_manager.send_to(
                    session_id, participant_id, {"type": "pong"}
                )
                continue

            if message_type == "share_similarity_reason":
                await _handle_similarity_reason_share(session_id, participant_id, payload)
                continue

            if message_type == "ranking_move":
                scope = _normalize_ranking_scope(payload.get("scope"))
                item_id = str(payload.get("itemId", ""))
                to_index = _normalize_int(payload.get("toIndex"), 0)
                base_revision = payload.get("baseRevision")
                normalized_base_revision = _normalize_optional_int(base_revision)
                logger.info(
                    "ranking_move received session_id=%s participant_id=%s scope=%s item_id=%s to_index=%s base_revision=%s",
                    session_id,
                    participant_id,
                    scope,
                    item_id,
                    to_index,
                    base_revision,
                )
                async with session_locks[session_id]:
                    state = _get_ranking_state(session_id, participant_id, scope)
                    previous_items = list(state["items"])
                    previous_real_items, _ = split_ranking_items(previous_items)
                    from_index = (
                        previous_real_items.index(item_id)
                        if item_id in previous_real_items
                        else None
                    )
                    try:
                        ranking_limit = _get_active_ranking_limit(session_id)
                        next_items = _apply_ranking_move(
                            previous_items,
                            item_id,
                            to_index,
                            ranking_limit=ranking_limit,
                        )
                    except ValueError as exc:
                        logger.warning(
                            "ranking_move rejected session_id=%s participant_id=%s scope=%s reason=%s",
                            session_id,
                            participant_id,
                            scope,
                            exc,
                        )
                        await board_manager.send_to(
                            session_id,
                            participant_id,
                            {
                                "type": "ranking_error",
                                "scope": scope,
                                "reason": str(exc),
                                "current": _ranking_payload(session_id, state),
                            },
                        )
                        continue
                    next_revision = state["revision"] + 1
                    next_real_items, _ = split_ranking_items(next_items)
                    final_to_index = next_real_items.index(item_id)
                    saved_ranking_move_id: int | None = None
                    async with SessionLocal() as db:
                        try:
                            saved_ranking_move = await create_ranking_move(
                                session_name=session_id,
                                participant_id=participant_id,
                                scope=scope,
                                phase=_get_session_phase(session_id),
                                move_type="move",
                                item_id=item_id,
                                from_index=from_index,
                                to_index=final_to_index,
                                base_revision=normalized_base_revision,
                                revision=next_revision,
                                previous_items=previous_items,
                                items=next_items,
                                db=db,
                            )
                            saved_ranking_move_id = saved_ranking_move.id
                            if _get_session_phase(session_id) == "reflect" and scope == "private":
                                await create_reflect_ranking_move_snapshot(
                                    db,
                                    session_name=session_id,
                                    condition=session_cue_conditions[session_id],
                                    cue_enabled=is_similarity_cue_enabled(session_id),
                                    participant_id=participant_id,
                                    state={"items": next_items, "revision": next_revision},
                                    ranking_move_id=saved_ranking_move_id,
                                    ranking_item_catalog=_get_current_ranking_item_catalog(session_id),
                                )
                        except Exception as exc:
                            await db.rollback()
                            logger.warning(
                                "ranking_move_persist_failed session_id=%s participant_id=%s scope=%s item_id=%s reason=%s",
                                session_id,
                                participant_id,
                                scope,
                                item_id,
                                exc,
                            )
                            await board_manager.send_to(
                                session_id,
                                participant_id,
                                {
                                    "type": "ranking_error",
                                    "scope": scope,
                                    "reason": "failed to save ranking move",
                                    "current": _ranking_payload(session_id, state),
                                },
                            )
                            continue
                    state["items"] = next_items
                    state["revision"] = next_revision
                    logger.info(
                        "ranking_state updated session_id=%s revision=%s updated_by=%s scope=%s items=%s targets=%s ranking_move_id=%s",
                        session_id,
                        state["revision"],
                        participant_id,
                        scope,
                        state["items"],
                        board_manager.get_participants(session_id),
                        saved_ranking_move_id,
                    )
                    ranking_payload = _ranking_payload(session_id, state)
                    message = {
                        "type": "ranking_state",
                        "scope": scope,
                        "updatedBy": participant_id,
                        **ranking_payload,
                    }
                    if scope == "private":
                        await board_manager.send_to(session_id, participant_id, message)
                    else:
                        await board_manager.broadcast(session_id, message)
                    await admin_manager.broadcast(
                        session_id, _admin_ranking_state_message(session_id)
                    )
                continue

            if message_type == "public_chat_send":
                message_text = str(payload.get("message") or "").strip()
                client_message_id = str(payload.get("clientMessageId") or "").strip() or None
                if not message_text:
                    await board_manager.send_to(
                        session_id,
                        participant_id,
                        _public_chat_error_message("message cannot be empty", client_message_id),
                    )
                    continue
                if len(message_text) > 2000:
                    await board_manager.send_to(
                        session_id,
                        participant_id,
                        _public_chat_error_message("message is too long", client_message_id),
                    )
                    continue

                display_name = str(payload.get("displayName") or "").strip() or None
                async with SessionLocal() as db:
                    try:
                        saved_message = await create_chat_message(
                            ChatMessageCreate(
                                session_name=session_id,
                                user_id=_normalize_int(participant_id, 0),
                                display_name=display_name,
                                message=message_text,
                            ),
                            db,
                        )
                    except Exception as exc:
                        await db.rollback()
                        logger.warning(
                            "public_chat_send failed session_id=%s participant_id=%s reason=%s",
                            session_id,
                            participant_id,
                            exc,
                        )
                        await board_manager.send_to(
                            session_id,
                            participant_id,
                            _public_chat_error_message("failed to save message", client_message_id),
                        )
                        continue

                chat_msg = {
                    "type": "public_chat_message",
                    "payload": _chat_message_payload(saved_message, client_message_id),
                }
                await board_manager.broadcast(session_id, chat_msg)
                await admin_manager.broadcast(session_id, chat_msg)
                continue

            if message_type in {"block_publish", "block_discard", "block_edit"}:
                await _handle_board_block_message(session_id, participant_id, payload)

    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        if not _is_websocket_disconnect_runtime_error(exc):
            raise
    finally:
        await board_manager.disconnect(session_id, participant_id, websocket)
        if not board_manager.get_participants(session_id):
            _public_context_windows.pop(session_id, None)
            pending_public_context_task = _public_context_matching_tasks.pop(session_id, None)
            if pending_public_context_task is not None and not pending_public_context_task.done():
                pending_public_context_task.cancel()
        logger.info(
            "board ws disconnected session_id=%s participant_id=%s participants=%s",
            session_id,
            participant_id,
            board_manager.get_participants(session_id),
        )
        await broadcast_presence_state(session_id)


async def handle_admin_websocket(
    websocket: WebSocket, *, session_id: str, admin_id: str
) -> None:
    connected = await admin_manager.connect(
        session_id,
        admin_id,
        websocket,
        duplicate_message=DUPLICATE_ADMIN_MESSAGE,
        duplicate_error_code="DUPLICATE_ADMIN",
    )
    if not connected:
        logger.info(
            "admin ws duplicate rejected session_id=%s admin_id=%s",
            session_id,
            admin_id,
        )
        return
    logger.info(
        "admin ws connected session_id=%s admin_id=%s admins=%s",
        session_id,
        admin_id,
        admin_manager.get_participants(session_id),
    )
    await admin_manager.send_to(
        session_id,
        admin_id,
        {
            "type": "joined",
            "session_name": session_id,
            "admin_id": admin_id,
            **_phase_state_message(session_id),
            "ranking_state": _admin_ranking_state_message(session_id),
        },
    )
    await admin_manager.send_to(
        session_id,
        admin_id,
        _public_context_component_state_message(session_id),
    )

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                payload = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            message_type = payload.get("type")
            if message_type == "ping":
                await admin_manager.send_to(session_id, admin_id, {"type": "pong"})
            elif message_type == "join":
                await admin_manager.send_to(
                    session_id,
                    admin_id,
                    {
                        "type": "joined",
                        "session_name": session_id,
                        "admin_id": admin_id,
                        **_phase_state_message(session_id),
                        "ranking_state": _admin_ranking_state_message(session_id),
                    },
                )
                await admin_manager.send_to(
                    session_id,
                    admin_id,
                    _public_context_component_state_message(session_id),
                )
            elif message_type == "switch_phase":
                previous_phase = _get_session_phase(session_id)
                new_phase = _normalize_session_phase(session_id, payload.get("phase"))
                if "duration_s" in payload:
                    _set_session_countdown(
                        session_id, _normalize_int(payload.get("duration_s"), 0)
                    )

                async with session_locks[session_id]:
                    participant_ids = sorted(
                        {
                            *board_manager.get_participants(session_id),
                            *private_ranking_state[session_id].keys(),
                        }
                    )
                    ranking_initialization = None
                    async with SessionLocal() as db:
                        try:
                            if new_phase != previous_phase:
                                await create_phase_boundary_ranking_snapshots(
                                    db,
                                    session_name=session_id,
                                    from_phase=previous_phase,
                                    to_phase=new_phase,
                                    condition=session_cue_conditions[session_id],
                                    cue_enabled=is_similarity_cue_enabled(session_id),
                                    participant_ids=[
                                        participant_id
                                        for participant_id in participant_ids
                                        if not _is_admin_participant_id(participant_id)
                                    ],
                                    private_ranking_states=private_ranking_state[session_id],
                                    public_ranking_state=public_ranking_state.get(session_id),
                                    ranking_item_catalog=_get_current_ranking_item_catalog(session_id),
                                )
                            if new_phase == "group" and previous_phase != "group":
                                for checkpoint_participant_id in [
                                    participant_id
                                    for participant_id in participant_ids
                                    if not _is_admin_participant_id(participant_id)
                                ]:
                                    state = private_ranking_state[session_id].get(checkpoint_participant_id)
                                    if state is None:
                                        try:
                                            effective_state = await get_effective_ranking_state(
                                                db,
                                                session_name=session_id,
                                                scope="private",
                                                participant_id=checkpoint_participant_id,
                                                phase="private_phase_2",
                                            )
                                        except Exception as exc:
                                            logger.warning(
                                                "ranking_checkpoint_rebuild_failed session_id=%s participant_id=%s reason=%s",
                                                session_id,
                                                checkpoint_participant_id,
                                                exc,
                                            )
                                            continue
                                        checkpoint_real_items = list(effective_state.get("items") or [])
                                        checkpoint_items = _build_internal_ranking_items_for_session(
                                            session_id,
                                            checkpoint_real_items,
                                            change_count=_normalize_optional_int(effective_state.get("change_count")),
                                        )
                                        checkpoint_revision = _normalize_int(effective_state.get("revision"), 0)
                                    else:
                                        checkpoint_items = list(state.get("items") or [])
                                        checkpoint_revision = _normalize_int(state.get("revision"), 0)
                                    if not checkpoint_items:
                                        continue
                                    if _is_admin_participant_id(checkpoint_participant_id):
                                        continue
                                    await create_ranking_checkpoint(
                                        session_name=session_id,
                                        participant_id=checkpoint_participant_id,
                                        scope="private",
                                        phase="private_phase_2",
                                        revision=checkpoint_revision,
                                        items=checkpoint_items,
                                        db=db,
                                    )
                            ranking_initialization = await initialize_phase_rankings(
                                db,
                                session_name=session_id,
                                from_phase=previous_phase,
                                to_phase=new_phase,
                                participant_ids=[
                                    participant_id
                                    for participant_id in participant_ids
                                    if not _is_admin_participant_id(participant_id)
                                ],
                            )
                        except Exception as exc:
                            await db.rollback()
                            logger.exception(
                                "phase_snapshot_initialization_failed session_id=%s from_phase=%s to_phase=%s error=%s",
                                session_id,
                                previous_phase,
                                new_phase,
                                exc,
                            )
                            await admin_manager.send_to(
                                session_id,
                                admin_id,
                                {
                                    "type": "phase_transition_error",
                                    "reason": "failed to save phase ranking snapshot",
                                    "from_phase": previous_phase,
                                    "to_phase": new_phase,
                                },
                            )
                            continue

                    if ranking_initialization is not None:
                        session_ranking_item_catalog[session_id] = ranking_initialization.ranking_items
                        if ranking_initialization.private_items_by_participant_id is not None:
                            for participant_id, item_ids in ranking_initialization.private_items_by_participant_id.items():
                                private_ranking_state[session_id][participant_id] = _create_ranking_state_from_items(
                                    session_id,
                                    list(item_ids),
                                )
                        if ranking_initialization.public_items is not None:
                            public_ranking_state[session_id] = _create_ranking_state_from_items(
                                session_id,
                                list(ranking_initialization.public_items),
                            )
                    elif new_phase == get_default_phase_for_session(session_name=session_id):
                        session_ranking_item_catalog.pop(session_id, None)

                    session_phases[session_id] = new_phase

                phase_changed_msg = _phase_changed_message(session_id)
                await admin_manager.broadcast(session_id, phase_changed_msg)
                await board_manager.broadcast(session_id, phase_changed_msg)
                await cue_manager.broadcast(session_id, phase_changed_msg)
                for participant_id in board_manager.get_participants(session_id):
                    await board_manager.send_to(
                        session_id,
                        participant_id,
                        _board_state_message(session_id, participant_id),
                    )
                await admin_manager.broadcast(session_id, _admin_ranking_state_message(session_id))
            elif message_type == "set_countdown":
                _set_session_countdown(
                    session_id, _normalize_int(payload.get("duration_s"), 0)
                )
                countdown_changed_msg = _countdown_changed_message(session_id)
                await admin_manager.broadcast(session_id, countdown_changed_msg)
                await board_manager.broadcast(session_id, countdown_changed_msg)
                await cue_manager.broadcast(session_id, countdown_changed_msg)
            elif message_type == "set_cue_condition":
                next_condition = _normalize_cue_condition(payload.get("condition"))
                session_cue_conditions[session_id] = next_condition
                cue_condition_msg = {
                    "type": "cue_condition_changed",
                    "condition": next_condition,
                    "cue_condition": next_condition,
                    "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
                    "timestamp_ms": _now_ms(),
                }
                await admin_manager.broadcast(session_id, cue_condition_msg)
                await board_manager.broadcast(session_id, cue_condition_msg)
                await cue_manager.broadcast(session_id, cue_condition_msg)
            elif message_type == "set_public_context_components":
                raw_component_ids = (
                    payload.get("componentIds")
                    if "componentIds" in payload
                    else payload.get("component_ids", payload.get("componentId", payload.get("component_id")))
                )
                raw_task_item_ids = (
                    payload.get("taskItemIds")
                    if "taskItemIds" in payload
                    else payload.get("task_item_ids", payload.get("taskItemId", payload.get("task_item_id")))
                )
                should_clear = payload.get("clear") is True
                component_ids = [] if should_clear else _normalize_public_context_component_ids(session_id, raw_component_ids)
                task_item_ids = [] if should_clear else _normalize_public_context_task_item_ids(session_id, raw_task_item_ids)
                has_raw_now_targets = bool(raw_component_ids) or bool(raw_task_item_ids)
                if not should_clear and has_raw_now_targets and not component_ids and not task_item_ids:
                    await admin_manager.send_to(
                        session_id,
                        admin_id,
                        {
                            "type": "public_context_component_error",
                            "reason": "no valid NOW targets",
                            "componentIds": [],
                            "taskItemIds": [],
                        },
                    )
                    continue

                matches: list[PublicContextMatch] = []
                if component_ids or task_item_ids:
                    async with SessionLocal() as db:
                        try:
                            if component_ids:
                                matches.extend(
                                    await find_public_context_component_matches(
                                        db,
                                        session_name=session_id,
                                        component_ids=component_ids,
                                    )
                                )
                            if task_item_ids:
                                matches.extend(
                                    await find_public_context_task_item_matches(
                                        db,
                                        session_name=session_id,
                                        task_item_ids=task_item_ids,
                                    )
                                )
                        except Exception as exc:
                            await db.rollback()
                            logger.warning(
                                "admin_public_context_component_failed session_id=%s admin_id=%s component_ids=%s task_item_ids=%s error_type=%s error=%s",
                                session_id,
                                admin_id,
                                component_ids,
                                task_item_ids,
                                exc.__class__.__name__,
                                exc,
                            )
                            await admin_manager.send_to(
                                session_id,
                                admin_id,
                                {
                                    "type": "public_context_component_error",
                                    "reason": "failed to set NOW target",
                                    "componentIds": component_ids,
                                    "taskItemIds": task_item_ids,
                                },
                            )
                            continue
                await _publish_public_context_matches(
                    session_id,
                    matches=matches,
                    source="manual_clear" if not component_ids and not task_item_ids else "manual",
                    participant_id=admin_id,
                    component_ids=component_ids,
                    task_item_ids=task_item_ids,
                )
            elif message_type == "public_chat_send":
                message_text = str(payload.get("message") or "").strip()
                client_message_id = str(payload.get("clientMessageId") or "").strip() or None
                if not message_text:
                    await admin_manager.send_to(
                        session_id,
                        admin_id,
                        _public_chat_error_message("message cannot be empty", client_message_id),
                    )
                    continue
                if len(message_text) > 2000:
                    await admin_manager.send_to(
                        session_id,
                        admin_id,
                        _public_chat_error_message("message is too long", client_message_id),
                    )
                    continue

                display_name = str(payload.get("displayName") or "").strip() or None
                async with SessionLocal() as db:
                    try:
                        saved_message = await create_chat_message(
                            ChatMessageCreate(
                                session_name=session_id,
                                user_id=0,
                                display_name=display_name,
                                message=message_text,
                            ),
                            db,
                        )
                    except Exception as exc:
                        await db.rollback()
                        logger.warning(
                            "admin public_chat_send failed session_id=%s admin_id=%s reason=%s",
                            session_id,
                            admin_id,
                            exc,
                        )
                        await admin_manager.send_to(
                            session_id,
                            admin_id,
                            _public_chat_error_message("failed to save message", client_message_id),
                        )
                        continue

                chat_msg = {
                    "type": "public_chat_message",
                    "payload": _chat_message_payload(saved_message, client_message_id),
                }
                await board_manager.broadcast(session_id, chat_msg)
                await admin_manager.broadcast(session_id, chat_msg)
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        if not _is_websocket_disconnect_runtime_error(exc):
            raise
    finally:
        await admin_manager.disconnect(session_id, admin_id, websocket)
        logger.info(
            "admin ws disconnected session_id=%s admin_id=%s admins=%s",
            session_id,
            admin_id,
            admin_manager.get_participants(session_id),
        )


async def _handle_board_block_message(
    session_id: str,
    participant_id: str,
    payload: dict[str, Any],
) -> None:
    blocks = board_blocks[session_id]
    message_type = payload.get("type")
    block_id = str(payload.get("block_id") or f"blk_{_now_ms()}")
    content = str(payload.get("content") or "")

    if message_type == "block_discard":
        await board_manager.send_to(
            session_id,
            participant_id,
            {
                "type": "block_discarded",
                "block_id": block_id,
                "participant_id": participant_id,
            },
        )
        return

    scope = "public" if message_type == "block_publish" else "private"
    block = {
        "type": "block_added" if message_type == "block_publish" else "block_updated",
        "block_id": block_id,
        "scope": scope,
        "participant_id": participant_id,
        "content": content,
        "color_tag": payload.get("color_tag", "blue"),
        "linked_cue_id": payload.get("linked_cue_id"),
        "timestamp_ms": _now_ms(),
    }

    target_list = (
        blocks["public_blocks"] if scope == "public" else blocks["private_blocks"]
    )
    existing_index = next(
        (
            index
            for index, existing in enumerate(target_list)
            if existing.get("block_id") == block_id
        ),
        None,
    )
    if existing_index is None:
        target_list.append(block)
    else:
        target_list[existing_index] = {**target_list[existing_index], **block}

    if scope == "public":
        await board_manager.broadcast(session_id, block)
    else:
        await board_manager.send_to(session_id, participant_id, block)


async def handle_cue_websocket(
    websocket: WebSocket, *, session_id: str, participant_id: str
) -> None:
    connected = await cue_manager.connect(session_id, participant_id, websocket)
    if not connected:
        logger.info(
            "cue ws duplicate rejected session_id=%s participant_id=%s",
            session_id,
            participant_id,
        )
        return
    await cue_manager.send_to(
        session_id,
        participant_id,
        {
            "type": "joined",
            "session_name": session_id,
            "participant_id": participant_id,
            **_phase_state_message(session_id),
        },
    )

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                payload = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            message_type = payload.get("type")
            if message_type == "ping":
                await cue_manager.send_to(session_id, participant_id, {"type": "pong"})
            elif message_type == "join":
                await cue_manager.send_to(
                    session_id,
                    participant_id,
                    {
                        "type": "joined",
                        "session_name": session_id,
                        "participant_id": participant_id,
                        **_phase_state_message(session_id),
                    },
                )
            elif message_type == "cue_response":
                cue_responses[session_id].append(
                    {
                        "cue_id": payload.get("cue_id"),
                        "participant_id": participant_id,
                        "response": payload.get("response"),
                        "timestamp_ms": payload.get("timestamp_ms", _now_ms()),
                    }
                )
                await cue_manager.send_to(
                    session_id,
                    participant_id,
                    {"type": "cue_response_recorded", "cue_id": payload.get("cue_id")},
                )
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        if not _is_websocket_disconnect_runtime_error(exc):
            raise
    finally:
        await cue_manager.disconnect(session_id, participant_id, websocket)


async def handle_presence_websocket(
    websocket: WebSocket, *, session_id: str, participant_id: str
) -> None:
    connected = await presence_manager.connect(session_id, participant_id, websocket)
    if not connected:
        logger.info(
            "presence ws duplicate rejected session_id=%s participant_id=%s",
            session_id,
            participant_id,
        )
        return
    await presence_manager.send_to(
        session_id,
        participant_id,
        {
            **_presence_state_message(session_id),
        },
    )
    await broadcast_presence_state(session_id)

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                payload = json.loads(raw_text)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            message_type = payload.get("type")
            if message_type == "ping":
                await presence_manager.send_to(
                    session_id, participant_id, {"type": "pong"}
                )
            elif message_type == "join":
                display_name = (
                    str(
                        payload.get("displayName")
                        or payload.get("display_name")
                        or payload.get("name")
                        or ""
                    ).strip()
                    or None
                )
                client_id = (
                    str(payload.get("clientId") or payload.get("client_id") or "").strip()
                    or None
                )
                update_participant_metadata(
                    session_id,
                    participant_id,
                    display_name=display_name,
                    client_id=client_id,
                )
                await presence_manager.send_to(
                    session_id,
                    participant_id,
                    {
                        **_presence_state_message(session_id),
                    },
                )
                await broadcast_presence_state(session_id)
            elif message_type == "activity":
                await presence_manager.broadcast(
                    session_id,
                    {
                        "type": "someone_typing",
                        "context": payload.get("context", "private_board"),
                    },
                    exclude={participant_id},
                )
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        if not _is_websocket_disconnect_runtime_error(exc):
            raise
    finally:
        await presence_manager.disconnect(session_id, participant_id, websocket)
        await broadcast_presence_state(session_id)


async def handle_audio_websocket(
    websocket: WebSocket, *, session_id: str, participant_id: str
) -> None:
    connected = await audio_manager.connect(session_id, participant_id, websocket)
    if not connected:
        logger.info(
            "audio ws duplicate rejected session_id=%s participant_id=%s",
            session_id,
            participant_id,
        )
        return
    state = AudioConnectionState(websocket=websocket)
    audio_connections[session_id][participant_id] = state
    transcript_segments = []
    logger.info(
        "audio ws connected session_id=%s participant_id=%s", session_id, participant_id
    )

    async with SessionLocal() as db:

        async def flush_buffer() -> None:
            if not state.audio_buffer:
                return
            raw_bytes = bytes(state.audio_buffer)
            state.audio_buffer.clear()
            logger.info(
                "audio ws flush session_id=%s participant_id=%s bytes=%s mic_mode=%s sample_rate=%s",
                session_id,
                participant_id,
                len(raw_bytes),
                state.mic_mode,
                state.sample_rate,
            )
            aligned_size = len(raw_bytes) - (len(raw_bytes) % 2)
            if aligned_size <= 0:
                return
            chunk = raw_bytes[:aligned_size]
            transcript_text = await transcribe_ws_chunk(
                pcm16_bytes=chunk,
                sample_rate=state.sample_rate,
                channels=1,
            )
            if not transcript_text:
                return
            if state.mic_mode != "private":
                logger.info(
                    "audio ws transcript skipped for non-private mic session_id=%s participant_id=%s mic_mode=%s chars=%s",
                    session_id,
                    participant_id,
                    state.mic_mode,
                    len(transcript_text),
                )
                now = utc_now()
                saved_segment = await save_ws_transcript_segment(
                    db,
                    session_name=session_id,
                    participant_id=participant_id,
                    visibility=Visibility.PUBLIC,
                    transcript_text=transcript_text,
                    started_at=now,
                    ended_at=now,
                    display_name=state.display_name,
                )
                segment_id = saved_segment.segment_id if saved_segment else None
                await audio_manager.send_to(
                    session_id,
                    participant_id,
                    {
                        "type": "transcript",
                        "participant_id": participant_id,
                        "mic_mode": state.mic_mode,
                        "text": transcript_text,
                        "segment_id": segment_id,
                        "timestamp_ms": _now_ms(),
                        "persisted": saved_segment is not None,
                    },
                )
                await broadcast_admin_transcript(
                    session_id,
                    participant_id=participant_id,
                    scope=state.mic_mode,
                    text=transcript_text,
                    is_final=False,
                    persisted=saved_segment is not None,
                    transcript_segment_id=segment_id,
                )
                await broadcast_public_transcript_line(
                    session_id,
                    participant_id=participant_id,
                    text=transcript_text,
                    transcript_segment_id=segment_id,
                )
                return
            now = utc_now()
            saved_segment = await save_ws_transcript_segment(
                db,
                session_name=session_id,
                participant_id=participant_id,
                visibility=Visibility.PRIVATE
                if state.mic_mode == "private"
                else Visibility.PUBLIC,
                transcript_text=transcript_text,
                started_at=now,
                ended_at=now,
                display_name=state.display_name,
            )
            if saved_segment:
                transcript_segments.append(saved_segment)
                logger.info(
                    "audio ws transcript session_id=%s participant_id=%s segment_id=%s text=%s",
                    session_id,
                    participant_id,
                    saved_segment.segment_id,
                    saved_segment.text,
                )
                await audio_manager.send_to(
                    session_id,
                    participant_id,
                    {
                        "type": "transcript",
                        "participant_id": participant_id,
                        "mic_mode": state.mic_mode,
                        "text": saved_segment.text,
                        "segment_id": saved_segment.segment_id,
                        "timestamp_ms": _now_ms(),
                    },
                )
                await broadcast_admin_transcript(
                    session_id,
                    participant_id=participant_id,
                    scope=state.mic_mode,
                    text=saved_segment.text,
                    is_final=False,
                    persisted=True,
                    transcript_segment_id=saved_segment.segment_id,
                )

        try:
            while True:
                message = await websocket.receive()
                event_type = message.get("type")
                if event_type == "websocket.disconnect":
                    raise WebSocketDisconnect()

                raw_bytes = message.get("bytes")
                if raw_bytes is not None:
                    state.audio_buffer.extend(raw_bytes)
                    if len(state.audio_buffer) >= STREAM_CHUNK_SAMPLES * 2:
                        await flush_buffer()
                    continue

                raw_text = message.get("text")
                if raw_text is None:
                    continue
                try:
                    payload = json.loads(raw_text)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue

                message_type = payload.get("type")
                if message_type == "join":
                    state.sample_rate = (
                        _normalize_int(payload.get("sample_rate"), 16000) or 16000
                    )
                    state.mic_mode = str(payload.get("mic_mode") or "private")
                    display_name = (
                        str(
                            payload.get("displayName")
                            or payload.get("display_name")
                            or payload.get("name")
                            or ""
                        ).strip()
                        or None
                    )
                    state.display_name = display_name
                    client_id = (
                        str(
                            payload.get("clientId") or payload.get("client_id") or ""
                        ).strip()
                        or None
                    )
                    update_audio_status(
                        session_id,
                        participant_id,
                        mic_mode=state.mic_mode,
                        audio_connected=True,
                        is_speaking=state.is_speaking,
                        display_name=display_name,
                        client_id=client_id,
                    )
                    await broadcast_presence_state(session_id)
                    logger.info(
                        "audio ws join session_id=%s participant_id=%s sample_rate=%s mic_mode=%s",
                        session_id,
                        participant_id,
                        state.sample_rate,
                        state.mic_mode,
                    )
                    await audio_manager.send_to(
                        session_id,
                        participant_id,
                        {
                            "type": "joined",
                            "session_name": session_id,
                            "participant_id": participant_id,
                        },
                    )
                elif message_type == "speaking_start":
                    state.is_speaking = True
                    update_audio_status(
                        session_id,
                        participant_id,
                        mic_mode=state.mic_mode,
                        audio_connected=True,
                        is_speaking=True,
                    )
                    await broadcast_presence_state(session_id)
                    logger.info(
                        "audio ws speaking_start session_id=%s participant_id=%s",
                        session_id,
                        participant_id,
                    )
                elif message_type == "speaking_end":
                    state.is_speaking = False
                    update_audio_status(
                        session_id,
                        participant_id,
                        mic_mode=state.mic_mode,
                        audio_connected=True,
                        is_speaking=False,
                    )
                    await broadcast_presence_state(session_id)
                    logger.info(
                        "audio ws speaking_end session_id=%s participant_id=%s",
                        session_id,
                        participant_id,
                    )
                    await flush_buffer()
                elif message_type == "ping":
                    await audio_manager.send_to(
                        session_id, participant_id, {"type": "pong"}
                    )

        except WebSocketDisconnect:
            await flush_buffer()
        except RuntimeError as exc:
            if not _is_websocket_disconnect_runtime_error(exc):
                raise
            await flush_buffer()
        except Exception as exc:
            logger.exception("Unhandled audio WebSocket error: %s", exc)
            await audio_manager.send_to(
                session_id,
                participant_id,
                {"type": "transcript_error", "segment_id": None, "reason": "stt_error"},
            )
        finally:
            if transcript_segments and state.mic_mode == "private":
                idea_blocks = await generate_idea_blocks_from_stream_transcripts(
                    db,
                    session_name=session_id,
                    participant_id=participant_id,
                    visibility=Visibility.PRIVATE
                    if state.mic_mode == "private"
                    else Visibility.PUBLIC,
                    transcripts=transcript_segments,
                )
                await broadcast_admin_idea_blocks_update(
                    session_id,
                    participant_id=participant_id,
                    idea_blocks=_serialize_admin_idea_blocks(idea_blocks),
                )
            if audio_connections.get(session_id, {}).get(participant_id) is state:
                audio_connections.get(session_id, {}).pop(participant_id, None)
            mark_audio_disconnected(session_id, participant_id)
            await broadcast_presence_state(session_id)
            await audio_manager.disconnect(session_id, participant_id, websocket)
            logger.info(
                "audio ws disconnected session_id=%s participant_id=%s",
                session_id,
                participant_id,
            )
