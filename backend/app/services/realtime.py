import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..config import STREAM_CHUNK_SAMPLES, logger
from ..db import SessionLocal
from ..models import Visibility
from ..schemas import ChatMessageCreate
from ..task_config import RANKING_ITEMS
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
from .ranking_move_service import create_ranking_move
from .transcripts import save_ws_transcript_segment

DEFAULT_RANKING_ITEMS = RANKING_ITEMS
DEFAULT_RANKING_ITEM_SET = set(DEFAULT_RANKING_ITEMS)
DUPLICATE_CONNECTION_CLOSE_CODE = 1008
DUPLICATE_PARTICIPANT_MESSAGE = (
    "這個 participant ID 已經在此 session 中，不能重複進入。"
)
DUPLICATE_ADMIN_MESSAGE = "這個 admin 已經在此 session 中，不能重複進入。"
ADMIN_PARTICIPANT_ID = "admin"
ADMIN_PARTICIPANT_ID_PREFIX = f"{ADMIN_PARTICIPANT_ID}-"


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
session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
board_blocks: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
    lambda: {"public_blocks": [], "private_blocks": []}
)
cue_responses: dict[str, list[dict[str, Any]]] = defaultdict(list)
session_phases: dict[str, str] = defaultdict(lambda: "private")
session_timers: dict[str, dict[str, Any]] = defaultdict(
    lambda: {"end_time_ms": 0, "duration_s": 0}
)
session_cue_conditions: dict[str, str] = defaultdict(lambda: "experimental")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_session_phase(value: Any) -> str:
    phase = str(value or "private").lower()
    return phase if phase in {"private", "group"} else "private"


def _normalize_cue_condition(value: Any) -> str:
    condition = str(value or "experimental").lower()
    return condition if condition in {"experimental", "control"} else "experimental"


def is_similarity_cue_enabled(session_id: str) -> bool:
    return session_cue_conditions[session_id] == "experimental"


def _phase_state_message(session_id: str) -> dict[str, Any]:
    timer = session_timers[session_id]
    return {
        "current_phase": session_phases[session_id],
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
        "phase": session_phases[session_id],
        "end_time_ms": timer["end_time_ms"],
        "duration_s": timer["duration_s"],
        "cue_condition": session_cue_conditions[session_id],
        "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
        "timestamp_ms": _now_ms(),
    }


def _countdown_changed_message(session_id: str) -> dict[str, Any]:
    timer = session_timers[session_id]
    return {
        "type": "countdown_changed",
        "current_phase": session_phases[session_id],
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


def _chat_message_payload(chat_message: Any) -> dict[str, Any]:
    timestamp_ms = (
        int(chat_message.time_stamp.timestamp() * 1000)
        if chat_message.time_stamp
        else _now_ms()
    )
    return {
        "id": str(chat_message.id),
        "sessionName": chat_message.session_name,
        "userId": str(chat_message.user_id),
        "displayName": chat_message.display_name,
        "message": chat_message.message,
        "timestampMs": timestamp_ms,
        "isDeleted": chat_message.is_deleted,
    }


def _normalize_ranking_state(state: dict[str, Any]) -> dict[str, Any]:
    current_items = state.get("items")
    if not isinstance(current_items, list):
        current_items = []
    normalized_items = [
        item
        for index, item in enumerate(current_items)
        if isinstance(item, str)
        and item in DEFAULT_RANKING_ITEM_SET
        and current_items.index(item) == index
    ]
    normalized_items.extend(
        item for item in DEFAULT_RANKING_ITEMS if item not in normalized_items
    )
    if normalized_items != current_items:
        state["items"] = normalized_items
        state["revision"] = _normalize_int(state.get("revision"), 0) + 1
    return state


def _create_ranking_state() -> dict[str, Any]:
    return {
        "revision": 0,
        "items": list(DEFAULT_RANKING_ITEMS),
    }


def _get_public_ranking_state(session_id: str) -> dict[str, Any]:
    if session_id not in public_ranking_state:
        public_ranking_state[session_id] = _create_ranking_state()
    else:
        _normalize_ranking_state(public_ranking_state[session_id])
    return public_ranking_state[session_id]


def _get_private_ranking_state(session_id: str, participant_id: str) -> dict[str, Any]:
    if participant_id not in private_ranking_state[session_id]:
        private_ranking_state[session_id][participant_id] = _create_ranking_state()
    else:
        _normalize_ranking_state(private_ranking_state[session_id][participant_id])
    return private_ranking_state[session_id][participant_id]


def _get_ranking_state(
    session_id: str, participant_id: str, scope: str
) -> dict[str, Any]:
    if scope == "private":
        return _get_private_ranking_state(session_id, participant_id)
    return _get_public_ranking_state(session_id)


def _ranking_payload(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "revision": state["revision"],
        "items": list(state["items"]),
    }


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
        "ranking": {"items": list(public_state["items"])},
        "public_ranking": _ranking_payload(public_state),
        "private_ranking": _ranking_payload(private_state),
        "public_blocks": list(blocks["public_blocks"]),
        "private_blocks": private_blocks,
        "current_phase": session_phases[session_id],
        "timer_end_time_ms": session_timers[session_id]["end_time_ms"],
        "cue_condition": session_cue_conditions[session_id],
        "similarity_cue_enabled": is_similarity_cue_enabled(session_id),
    }


def _admin_ranking_state_message(session_id: str) -> dict[str, Any]:
    public_state = _get_public_ranking_state(session_id)
    private_rankings = {
        participant_id: _ranking_payload(state)
        for participant_id, state in sorted(private_ranking_state[session_id].items())
        if not _is_admin_participant_id(participant_id)
    }
    return {
        "type": "admin_ranking_state",
        "session_name": session_id,
        "revision": public_state["revision"],
        "public_ranking": _ranking_payload(public_state),
        "private_rankings": private_rankings,
    }


def _apply_ranking_move(items: list[str], item_id: str, to_index: int) -> list[str]:
    if item_id not in items:
        raise ValueError("ranking item does not exist")
    next_items = [item for item in items if item != item_id]
    bounded_index = max(0, min(to_index, len(next_items)))
    next_items.insert(bounded_index, item_id)
    return next_items


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
                    from_index = (
                        previous_items.index(item_id)
                        if item_id in previous_items
                        else None
                    )
                    try:
                        next_items = _apply_ranking_move(
                            previous_items, item_id, to_index
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
                                "current": _ranking_payload(state),
                            },
                        )
                        continue
                    next_revision = state["revision"] + 1
                    final_to_index = next_items.index(item_id)
                    async with SessionLocal() as db:
                        try:
                            await create_ranking_move(
                                session_name=session_id,
                                participant_id=participant_id,
                                scope=scope,
                                item_id=item_id,
                                from_index=from_index,
                                to_index=final_to_index,
                                base_revision=normalized_base_revision,
                                revision=next_revision,
                                previous_items=previous_items,
                                items=next_items,
                                db=db,
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
                                    "current": _ranking_payload(state),
                                },
                            )
                            continue
                    state["items"] = next_items
                    state["revision"] = next_revision
                    logger.info(
                        "ranking_state updated session_id=%s revision=%s updated_by=%s scope=%s items=%s targets=%s",
                        session_id,
                        state["revision"],
                        participant_id,
                        scope,
                        state["items"],
                        board_manager.get_participants(session_id),
                    )
                    message = {
                        "type": "ranking_state",
                        "scope": scope,
                        "revision": state["revision"],
                        "items": list(state["items"]),
                        "updatedBy": participant_id,
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
                if not message_text:
                    await board_manager.send_to(
                        session_id,
                        participant_id,
                        {
                            "type": "public_chat_error",
                            "reason": "message cannot be empty",
                        },
                    )
                    continue
                if len(message_text) > 2000:
                    await board_manager.send_to(
                        session_id,
                        participant_id,
                        {"type": "public_chat_error", "reason": "message is too long"},
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
                            {
                                "type": "public_chat_error",
                                "reason": "failed to save message",
                            },
                        )
                        continue

                await board_manager.broadcast(
                    session_id,
                    {
                        "type": "public_chat_message",
                        "payload": _chat_message_payload(saved_message),
                    },
                )
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
            elif message_type == "switch_phase":
                new_phase = _normalize_session_phase(payload.get("phase"))
                session_phases[session_id] = new_phase
                if "duration_s" in payload:
                    _set_session_countdown(
                        session_id, _normalize_int(payload.get("duration_s"), 0)
                    )

                phase_changed_msg = _phase_changed_message(session_id)
                await admin_manager.broadcast(session_id, phase_changed_msg)
                await board_manager.broadcast(session_id, phase_changed_msg)
                await cue_manager.broadcast(session_id, phase_changed_msg)
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
            elif message_type == "public_chat_send":
                message_text = str(payload.get("message") or "").strip()
                if not message_text:
                    await admin_manager.send_to(
                        session_id,
                        admin_id,
                        {
                            "type": "public_chat_error",
                            "reason": "message cannot be empty",
                        },
                    )
                    continue
                if len(message_text) > 2000:
                    await admin_manager.send_to(
                        session_id,
                        admin_id,
                        {"type": "public_chat_error", "reason": "message is too long"},
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
                            {
                                "type": "public_chat_error",
                                "reason": "failed to save message",
                            },
                        )
                        continue

                chat_msg = {
                    "type": "public_chat_message",
                    "payload": _chat_message_payload(saved_message),
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
            transcript_text = await transcribe_ws_chunk(chunk)
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
