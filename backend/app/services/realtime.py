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
from ..utils import utc_now
from .asr import transcribe_ws_chunk
from .idea_blocks import generate_idea_blocks_from_stream_transcripts
from .transcripts import save_ws_transcript_segment


DEFAULT_RANKING_ITEMS = [
    "mosquito_net",
    "petrol",
    "water_container",
    "shaving_mirror",
    "sextant",
    "emergency_rations",
    "sea_chart",
    "floating_cushion",
    "rope",
    "chocolate_bars",
    "waterproof_sheet",
    "fishing_rod",
    "shark_repellent",
    "rum",
    "vhf_radio",
]
DEFAULT_RANKING_ITEM_SET = set(DEFAULT_RANKING_ITEMS)


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[str, dict[str, WebSocket]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, participant_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            previous = self.connections[session_id].get(participant_id)
            if previous and previous.client_state == WebSocketState.CONNECTED:
                await self._close_safely(previous, code=1000)
            self.connections[session_id][participant_id] = websocket

    async def disconnect(self, session_id: str, participant_id: str) -> None:
        async with self._lock:
            participants = self.connections.get(session_id)
            if not participants:
                return
            participants.pop(participant_id, None)
            if not participants:
                self.connections.pop(session_id, None)

    async def send_to(self, session_id: str, participant_id: str, message: dict[str, Any]) -> None:
        websocket = self.connections.get(session_id, {}).get(participant_id)
        if websocket is None:
            return
        await self._send_json_safely(websocket, message)

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
            for participant_id, websocket in self.connections.get(session_id, {}).items()
            if participant_id not in exclude
        ]
        disconnected: list[str] = []
        for participant_id, websocket in targets:
            sent = await self._send_json_safely(websocket, message)
            if not sent:
                disconnected.append(participant_id)
        for participant_id in disconnected:
            await self.disconnect(session_id, participant_id)

    def get_participants(self, session_id: str) -> list[str]:
        return sorted(self.connections.get(session_id, {}).keys())

    async def _send_json_safely(self, websocket: WebSocket, message: dict[str, Any]) -> bool:
        if websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await websocket.send_json(message)
            return True
        except Exception as exc:
            logger.warning("Failed to send WebSocket payload: %s", exc)
            return False

    async def _close_safely(self, websocket: WebSocket, *, code: int) -> None:
        try:
            await websocket.close(code=code)
        except Exception:
            return


@dataclass
class AudioConnectionState:
    websocket: WebSocket
    sample_rate: int = 16000
    mic_mode: str = "private"
    is_speaking: bool = False
    audio_buffer: bytearray = field(default_factory=bytearray)


audio_manager = ConnectionManager()
board_manager = ConnectionManager()
cue_manager = ConnectionManager()
presence_manager = ConnectionManager()

audio_connections: dict[str, dict[str, AudioConnectionState]] = defaultdict(dict)
ranking_state: dict[str, dict[str, Any]] = {}
session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
board_blocks: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
    lambda: {"public_blocks": [], "private_blocks": []}
)
cue_responses: dict[str, list[dict[str, Any]]] = defaultdict(list)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def _get_ranking_state(session_id: str) -> dict[str, Any]:
    if session_id not in ranking_state:
        ranking_state[session_id] = {
            "revision": 0,
            "items": list(DEFAULT_RANKING_ITEMS),
        }
    else:
        current_items = ranking_state[session_id].get("items")
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
            ranking_state[session_id]["items"] = normalized_items
            ranking_state[session_id]["revision"] = _normalize_int(
                ranking_state[session_id].get("revision"),
                0,
            ) + 1
    return ranking_state[session_id]


def _board_state_message(session_id: str, participant_id: str) -> dict[str, Any]:
    state = _get_ranking_state(session_id)
    blocks = board_blocks[session_id]
    private_blocks = [
        block
        for block in blocks["private_blocks"]
        if block.get("participant_id") == participant_id
    ]
    return {
        "type": "board_state",
        "session_name": session_id,
        "revision": state["revision"],
        "ranking": {"items": list(state["items"])},
        "public_blocks": list(blocks["public_blocks"]),
        "private_blocks": private_blocks,
    }


def _apply_ranking_move(items: list[str], item_id: str, to_index: int) -> list[str]:
    if item_id not in items:
        raise ValueError("ranking item does not exist")
    next_items = [item for item in items if item != item_id]
    bounded_index = max(0, min(to_index, len(next_items)))
    next_items.insert(bounded_index, item_id)
    return next_items


async def handle_board_websocket(websocket: WebSocket, *, session_id: str, participant_id: str) -> None:
    await board_manager.connect(session_id, participant_id, websocket)
    logger.info(
        "board ws connected session_id=%s participant_id=%s participants=%s",
        session_id,
        participant_id,
        board_manager.get_participants(session_id),
    )
    await board_manager.send_to(
        session_id,
        participant_id,
        {"type": "joined", "session_name": session_id, "participant_id": participant_id},
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
                continue

            if message_type == "ping":
                await board_manager.send_to(session_id, participant_id, {"type": "pong"})
                continue

            if message_type == "ranking_move":
                item_id = str(payload.get("itemId", ""))
                to_index = _normalize_int(payload.get("toIndex"), 0)
                base_revision = payload.get("baseRevision")
                logger.info(
                    "ranking_move received session_id=%s participant_id=%s item_id=%s to_index=%s base_revision=%s",
                    session_id,
                    participant_id,
                    item_id,
                    to_index,
                    base_revision,
                )
                async with session_locks[session_id]:
                    state = _get_ranking_state(session_id)
                    try:
                        state["items"] = _apply_ranking_move(list(state["items"]), item_id, to_index)
                    except ValueError as exc:
                        logger.warning(
                            "ranking_move rejected session_id=%s participant_id=%s reason=%s",
                            session_id,
                            participant_id,
                            exc,
                        )
                        await board_manager.send_to(
                            session_id,
                            participant_id,
                            {"type": "ranking_error", "reason": str(exc), "current": state},
                        )
                        continue
                    state["revision"] += 1
                    logger.info(
                        "ranking_state broadcast session_id=%s revision=%s updated_by=%s items=%s targets=%s",
                        session_id,
                        state["revision"],
                        participant_id,
                        state["items"],
                        board_manager.get_participants(session_id),
                    )
                    await board_manager.broadcast(
                        session_id,
                        {
                            "type": "ranking_state",
                            "revision": state["revision"],
                            "items": list(state["items"]),
                            "updatedBy": participant_id,
                        },
                    )
                continue

            if message_type in {"block_publish", "block_discard", "block_edit"}:
                await _handle_board_block_message(session_id, participant_id, payload)

    except WebSocketDisconnect:
        pass
    finally:
        await board_manager.disconnect(session_id, participant_id)
        logger.info(
            "board ws disconnected session_id=%s participant_id=%s participants=%s",
            session_id,
            participant_id,
            board_manager.get_participants(session_id),
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
            {"type": "block_discarded", "block_id": block_id, "participant_id": participant_id},
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

    target_list = blocks["public_blocks"] if scope == "public" else blocks["private_blocks"]
    existing_index = next((index for index, existing in enumerate(target_list) if existing.get("block_id") == block_id), None)
    if existing_index is None:
        target_list.append(block)
    else:
        target_list[existing_index] = {**target_list[existing_index], **block}

    if scope == "public":
        await board_manager.broadcast(session_id, block)
    else:
        await board_manager.send_to(session_id, participant_id, block)


async def handle_cue_websocket(websocket: WebSocket, *, session_id: str, participant_id: str) -> None:
    await cue_manager.connect(session_id, participant_id, websocket)
    await cue_manager.send_to(session_id, participant_id, {"type": "joined", "session_name": session_id, "participant_id": participant_id})

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
                await cue_manager.send_to(session_id, participant_id, {"type": "joined", "session_name": session_id, "participant_id": participant_id})
            elif message_type == "cue_response":
                cue_responses[session_id].append(
                    {
                        "cue_id": payload.get("cue_id"),
                        "participant_id": participant_id,
                        "response": payload.get("response"),
                        "timestamp_ms": payload.get("timestamp_ms", _now_ms()),
                    }
                )
                await cue_manager.send_to(session_id, participant_id, {"type": "cue_response_recorded", "cue_id": payload.get("cue_id")})
    except WebSocketDisconnect:
        pass
    finally:
        await cue_manager.disconnect(session_id, participant_id)


async def handle_presence_websocket(websocket: WebSocket, *, session_id: str, participant_id: str) -> None:
    await presence_manager.connect(session_id, participant_id, websocket)
    await presence_manager.send_to(
        session_id,
        participant_id,
        {
            "type": "presence_state",
            "session_name": session_id,
            "participants": presence_manager.get_participants(session_id),
        },
    )
    await presence_manager.broadcast(
        session_id,
        {
            "type": "participant_joined",
            "participant_id": participant_id,
            "total": len(presence_manager.get_participants(session_id)),
        },
        exclude={participant_id},
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
                await presence_manager.send_to(session_id, participant_id, {"type": "pong"})
            elif message_type == "join":
                await presence_manager.send_to(
                    session_id,
                    participant_id,
                    {
                        "type": "presence_state",
                        "session_name": session_id,
                        "participants": presence_manager.get_participants(session_id),
                    },
                )
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
    finally:
        await presence_manager.disconnect(session_id, participant_id)
        await presence_manager.broadcast(
            session_id,
            {
                "type": "participant_left",
                "participant_id": participant_id,
                "total": len(presence_manager.get_participants(session_id)),
            },
        )


async def handle_audio_websocket(websocket: WebSocket, *, session_id: str, participant_id: str) -> None:
    await audio_manager.connect(session_id, participant_id, websocket)
    state = AudioConnectionState(websocket=websocket)
    audio_connections[session_id][participant_id] = state
    transcript_segments = []
    logger.info("audio ws connected session_id=%s participant_id=%s", session_id, participant_id)

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
            now = utc_now()
            saved_segment = await save_ws_transcript_segment(
                db,
                session_name=session_id,
                participant_id=participant_id,
                visibility=Visibility.PRIVATE if state.mic_mode == "private" else Visibility.PUBLIC,
                transcript_text=transcript_text,
                started_at=now,
                ended_at=now,
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
                    state.sample_rate = _normalize_int(payload.get("sample_rate"), 16000) or 16000
                    state.mic_mode = str(payload.get("mic_mode") or "private")
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
                        {"type": "joined", "session_name": session_id, "participant_id": participant_id},
                    )
                elif message_type == "speaking_start":
                    state.is_speaking = True
                    logger.info("audio ws speaking_start session_id=%s participant_id=%s", session_id, participant_id)
                elif message_type == "speaking_end":
                    state.is_speaking = False
                    logger.info("audio ws speaking_end session_id=%s participant_id=%s", session_id, participant_id)
                    await flush_buffer()
                elif message_type == "ping":
                    await audio_manager.send_to(session_id, participant_id, {"type": "pong"})

        except WebSocketDisconnect:
            await flush_buffer()
        except Exception as exc:
            logger.exception("Unhandled audio WebSocket error: %s", exc)
            await audio_manager.send_to(
                session_id,
                participant_id,
                {"type": "transcript_error", "segment_id": None, "reason": "stt_error"},
            )
        finally:
            if transcript_segments:
                await generate_idea_blocks_from_stream_transcripts(
                    db,
                    session_name=session_id,
                    participant_id=participant_id,
                    visibility=Visibility.PRIVATE if state.mic_mode == "private" else Visibility.PUBLIC,
                    transcripts=transcript_segments,
                )
            audio_connections.get(session_id, {}).pop(participant_id, None)
            await audio_manager.disconnect(session_id, participant_id)
            logger.info("audio ws disconnected session_id=%s participant_id=%s", session_id, participant_id)
