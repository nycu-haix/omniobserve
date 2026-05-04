import asyncio
import json
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..config import STREAM_CHUNK_SAMPLES, logger
from ..db import SessionLocal
from ..models import Visibility
from ..schemas import StreamContext, StreamTranscript
from ..utils import utc_now
from .asr import transcribe_ws_chunk
from .transcript_pipeline import handle_transcript_segment, serialize_pipeline_result
from .transcripts import save_ws_transcript_segment


def parse_stream_start_message(raw_text: str, *, expected_session_name: str | None = None) -> StreamContext:
    payload = json.loads(raw_text)
    if not isinstance(payload, dict) or payload.get("type") != "start":
        raise ValueError("First WebSocket message must be a start message")

    if expected_session_name is not None:
        for field_name in ("sessionName", "sessionId", "roomName"):
            metadata_session_name = payload.get(field_name)
            if metadata_session_name is None or str(metadata_session_name).strip() == "":
                continue
            if str(metadata_session_name).strip() != expected_session_name:
                raise ValueError(f"start.{field_name} must match URL session_name")

    scope_raw = payload.get("scope")
    try:
        scope = Visibility(scope_raw)
    except ValueError as exc:
        raise ValueError("start.scope must be public or private") from exc

    sample_rate_raw = payload.get("sampleRate", 16000)
    try:
        sample_rate = int(sample_rate_raw)
    except (TypeError, ValueError):
        sample_rate = 16000
    if sample_rate <= 0:
        sample_rate = 16000

    channels_raw = payload.get("channels", 1)
    try:
        channels = int(channels_raw)
    except (TypeError, ValueError):
        channels = 1
    if channels <= 0:
        channels = 1

    client_id = payload.get("clientId")
    if client_id is not None:
        client_id = str(client_id)

    encoding_raw = payload.get("encoding")
    encoding = str(encoding_raw).lower() if encoding_raw is not None else "float32_pcm"
    if encoding == "float32":
        encoding = "float32_pcm"
    if encoding == "int16":
        encoding = "int16_pcm"
    if encoding not in {"float32_pcm", "int16_pcm"}:
        raise ValueError("start.encoding must be float32_pcm or int16_pcm")

    if channels != 1:
        raise ValueError("start.channels must be 1 (mono)")

    return StreamContext(
        scope=scope,
        sample_rate=sample_rate,
        client_id=client_id,
        source=str(payload.get("source")) if payload.get("source") is not None else None,
        agent_type=str(payload.get("agentType")) if payload.get("agentType") is not None else None,
        encoding=encoding,
        channels=channels,
        start_message=payload,
    )


async def send_ws_json_safe(websocket: WebSocket, payload: dict[str, Any]) -> None:
    if websocket.client_state != WebSocketState.CONNECTED:
        return
    try:
        await websocket.send_json(payload)
    except Exception as exc:
        logger.warning("Failed to send WebSocket message: %s", exc)


async def handle_audio_stream_websocket(
    websocket: WebSocket,
    *,
    session_name: str,
    participant_id: str,
) -> None:
    await websocket.accept()

    stream_context: StreamContext | None = None
    transcript_segments: list[StreamTranscript] = []
    int16_buffer = np.empty(0, dtype=np.int16)
    buffered_chunk_start_at: datetime | None = None
    stop_received = False

    async with SessionLocal() as db:

        async def flush_buffer(force: bool) -> None:
            nonlocal int16_buffer, buffered_chunk_start_at
            if stream_context is None:
                return

            while int16_buffer.size >= STREAM_CHUNK_SAMPLES or (force and int16_buffer.size > 0):
                chunk_samples = (
                    STREAM_CHUNK_SAMPLES if int16_buffer.size >= STREAM_CHUNK_SAMPLES else int16_buffer.size
                )
                chunk = int16_buffer[:chunk_samples]
                int16_buffer = int16_buffer[chunk_samples:]

                chunk_started_at = buffered_chunk_start_at or utc_now()
                chunk_ended_at = chunk_started_at + timedelta(
                    seconds=chunk_samples / max(stream_context.sample_rate, 1)
                )

                transcript_text = await transcribe_ws_chunk(
                    pcm16_bytes=chunk.tobytes(),
                    sample_rate=stream_context.sample_rate,
                    channels=stream_context.channels,
                )
                if transcript_text:
                    saved_segment = await save_ws_transcript_segment(
                        db,
                        session_name=session_name,
                        participant_id=participant_id,
                        visibility=stream_context.scope,
                        transcript_text=transcript_text,
                        started_at=chunk_started_at,
                        ended_at=chunk_ended_at,
                    )
                    if saved_segment:
                        transcript_segments.append(saved_segment)
                        await handle_transcript_segment(
                            db,
                            session_name=session_name,
                            user_id=_participant_id_to_int(participant_id),
                            transcript=saved_segment,
                            is_final=False,
                            visibility=stream_context.scope,
                        )
                        await send_ws_json_safe(
                            websocket,
                            {
                                "type": "transcript_update",
                                "transcript_segment_id": saved_segment.segment_id,
                                "text": saved_segment.text,
                                "is_final": False,
                            },
                        )

                buffered_chunk_start_at = chunk_ended_at if int16_buffer.size > 0 else None

        try:
            first_message = await websocket.receive_text()
            stream_context = parse_stream_start_message(first_message, expected_session_name=session_name)
            logger.info(
                "Audio stream started session_name=%s participant_id=%s encoding=%s sample_rate=%s channels=%s",
                session_name,
                participant_id,
                stream_context.encoding,
                stream_context.sample_rate,
                stream_context.channels,
            )
        except WebSocketDisconnect:
            return
        except Exception as exc:
            logger.warning("Invalid start message for audio stream: %s", exc)
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close(code=1003)
            return

        try:
            while True:
                message = await websocket.receive()
                event_type = message.get("type")

                if event_type == "websocket.disconnect":
                    raise WebSocketDisconnect()

                if event_type != "websocket.receive":
                    continue

                raw_bytes = message.get("bytes")
                if raw_bytes is not None:
                    if stream_context is None:
                        continue

                    bytes_per_sample = 4 if stream_context.encoding == "float32_pcm" else 2
                    if len(raw_bytes) < bytes_per_sample:
                        continue

                    aligned_size = len(raw_bytes) - (len(raw_bytes) % bytes_per_sample)
                    if aligned_size <= 0:
                        continue

                    if stream_context.encoding == "float32_pcm":
                        float32_array = np.frombuffer(raw_bytes[:aligned_size], dtype="<f4")
                        int16_array = (float32_array * 32767).clip(-32768, 32767).astype(np.int16)
                    else:
                        int16_array = np.frombuffer(raw_bytes[:aligned_size], dtype="<i2")

                    if int16_array.size == 0:
                        continue

                    if int16_buffer.size == 0:
                        buffered_chunk_start_at = utc_now()
                        int16_buffer = int16_array
                    else:
                        int16_buffer = np.concatenate((int16_buffer, int16_array))

                    await flush_buffer(force=False)
                    continue

                raw_text = message.get("text")
                if raw_text is None:
                    continue

                try:
                    payload = json.loads(raw_text)
                except json.JSONDecodeError:
                    logger.warning("Skipping non-JSON text message in audio stream")
                    continue

                if not isinstance(payload, dict):
                    continue

                if payload.get("type") == "stop":
                    stop_received = True
                    await flush_buffer(force=True)
                    idea_blocks_payload: list[dict[str, Any]] = []
                    task_items_payload: list[dict[str, Any]] = []
                    if transcript_segments:
                        try:
                            pipeline_result = await handle_transcript_segment(
                                db,
                                session_name=session_name,
                                user_id=_participant_id_to_int(participant_id),
                                transcript=None,
                                is_final=True,
                                visibility=stream_context.scope,
                            )
                        except Exception:
                            logger.exception(
                                "Transcript pipeline failed session_name=%s participant_id=%s",
                                session_name,
                                participant_id,
                            )
                            await send_ws_json_safe(
                                websocket,
                                {
                                    "type": "pipeline_error",
                                    "reason": "idea_block_or_task_item_generation_failed",
                                },
                            )
                            pipeline_result = None

                        if pipeline_result is not None:
                            serialized_result = serialize_pipeline_result(pipeline_result)
                            idea_blocks_payload = serialized_result["idea_blocks"]
                            task_items_payload = serialized_result["task_items"]

                    last_segment_id = transcript_segments[-1].segment_id if transcript_segments else None
                    last_text = transcript_segments[-1].text if transcript_segments else ""
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "transcript_update",
                            "transcript_segment_id": last_segment_id,
                            "text": last_text,
                            "is_final": True,
                        },
                    )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "idea_blocks_update",
                            "idea_blocks": idea_blocks_payload,
                        },
                    )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "task_items_update",
                            "task_items": task_items_payload,
                        },
                    )
                    if websocket.client_state == WebSocketState.CONNECTED:
                        await websocket.close()
                    return

        except WebSocketDisconnect:
            logger.info(
                "WebSocket disconnected unexpectedly, flushing buffered audio for session_name=%s participant_id=%s",
                session_name,
                participant_id,
            )
            await flush_buffer(force=True)
        except Exception as exc:
            logger.exception("Unhandled WebSocket audio stream error: %s", exc)
            await flush_buffer(force=True)
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close(code=1011)
        finally:
            if not stop_received and websocket.client_state == WebSocketState.CONNECTED:
                # Keep connection open unless stop arrives; close only in error paths above.
                await websocket.close()


def _normalize_visibility(value: Any) -> Visibility:
    try:
        return Visibility(value)
    except ValueError:
        return Visibility.PRIVATE


def _timestamp_from_seconds(value: Any) -> datetime:
    if isinstance(value, (int, float)) and value >= 0:
        return utc_now() + timedelta(seconds=0)
    return utc_now()


FINAL_TRANSCRIPT_REASONS = {"silence", "client_stop", "mic_mode_switch", "disconnect"}
_pending_transcript_batch_texts: dict[tuple[str, str], list[str]] = defaultdict(list)
_pending_transcript_batch_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)


async def handle_transcript_segments_websocket(
    websocket: WebSocket,
    *,
    session_name: str,
    participant_id: str,
) -> None:
    await websocket.accept()
    logger.info(
        "pipeline_ws_connected session_name=%s participant_id=%s",
        session_name,
        participant_id,
    )

    batch_key = (session_name, participant_id)

    async with SessionLocal() as db:
        try:
            while True:
                payload = await websocket.receive_json()
                if not isinstance(payload, dict):
                    continue

                message_type = payload.get("type")
                if message_type in {"ping", "heartbeat"}:
                    await send_ws_json_safe(websocket, {"type": "pong"})
                    continue
                if message_type == "stop":
                    logger.info(
                        "pipeline_ws_stop session_name=%s participant_id=%s",
                        session_name,
                        participant_id,
                    )
                    await send_ws_json_safe(websocket, {"type": "transcript_segments_stopped"})
                    await websocket.close()
                    return
                if message_type != "transcript_segment":
                    continue

                text = str(payload.get("text") or "").strip()
                reason = str(payload.get("reason") or "").strip().lower()
                visibility = _normalize_visibility(payload.get("scope") or payload.get("visibility") or "private")
                if not text:
                    logger.info(
                        "pipeline_ws_skip_empty_transcript session_name=%s participant_id=%s reason=%s",
                        session_name,
                        participant_id,
                        reason or "unknown",
                    )
                    continue
                logger.info(
                    "pipeline_ws_transcript_received session_name=%s participant_id=%s reason=%s visibility=%s chars=%s",
                    session_name,
                    participant_id,
                    reason or "unknown",
                    visibility.value,
                    len(text),
                )

                batch_texts: list[str] | None = None
                batch_text = ""
                async with _pending_transcript_batch_locks[batch_key]:
                    if reason == "max_speech_ms":
                        _pending_transcript_batch_texts[batch_key].append(text)
                        pending_segments = len(_pending_transcript_batch_texts[batch_key])
                        pending_chars = sum(len(item) for item in _pending_transcript_batch_texts[batch_key])
                        logger.info(
                            "pipeline_ws_batch_buffered session_name=%s participant_id=%s reason=%s batch_segments=%s batch_chars=%s",
                            session_name,
                            participant_id,
                            reason,
                            pending_segments,
                            pending_chars,
                        )
                        await send_ws_json_safe(
                            websocket,
                            {
                                "type": "transcript",
                                "text": text,
                                "is_final": False,
                                "reason": reason,
                                "persisted": False,
                            },
                        )
                        continue

                    if reason in FINAL_TRANSCRIPT_REASONS:
                        _pending_transcript_batch_texts[batch_key].append(text)
                        batch_texts = list(_pending_transcript_batch_texts.pop(batch_key, []))
                        batch_text = "\n".join(item for item in batch_texts if item.strip()).strip()
                        logger.info(
                            "pipeline_ws_batch_final session_name=%s participant_id=%s reason=%s batch_segments=%s batch_chars=%s",
                            session_name,
                            participant_id,
                            reason,
                            len(batch_texts),
                            len(batch_text),
                        )
                    else:
                        logger.info(
                            "pipeline_ws_transcript_ignored_for_generation session_name=%s participant_id=%s reason=%s",
                            session_name,
                            participant_id,
                            reason or "unknown",
                        )
                        continue

                timestamp = _timestamp_from_seconds(payload.get("start"))
                saved_segment = await save_ws_transcript_segment(
                    db,
                    session_name=session_name,
                    participant_id=participant_id,
                    visibility=visibility,
                    transcript_text=batch_text,
                    started_at=timestamp,
                    ended_at=timestamp,
                )

                if saved_segment is None:
                    async with _pending_transcript_batch_locks[batch_key]:
                        _pending_transcript_batch_texts[batch_key] = batch_texts or []
                    logger.info(
                        "pipeline_ws_batch_save_failed session_name=%s participant_id=%s reason=%s",
                        session_name,
                        participant_id,
                        reason or "unknown",
                    )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "transcript_error",
                            "reason": "save_failed",
                        },
                    )
                    continue

                logger.info(
                    "pipeline_ws_batch_saved session_name=%s participant_id=%s transcript_id=%s chars=%s",
                    session_name,
                    participant_id,
                    saved_segment.segment_id,
                    len(saved_segment.text),
                )
                await send_ws_json_safe(
                    websocket,
                    {
                        "type": "transcript_update",
                        "transcript_segment_id": saved_segment.segment_id,
                        "text": saved_segment.text,
                        "is_final": True,
                        "reason": reason,
                        "persisted": True,
                    },
                )

                try:
                    logger.info(
                        "pipeline_ws_generation_start session_name=%s participant_id=%s reason=%s",
                        session_name,
                        participant_id,
                        reason,
                    )
                    pipeline_result = await handle_transcript_segment(
                        db,
                        session_name=session_name,
                        user_id=_participant_id_to_int(participant_id),
                        transcript=saved_segment,
                        is_final=True,
                        visibility=visibility,
                    )
                except Exception:
                    logger.exception(
                        "pipeline_ws_generation_failed session_name=%s participant_id=%s reason=%s",
                        session_name,
                        participant_id,
                        reason,
                    )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "pipeline_error",
                            "reason": "idea_block_or_task_item_generation_failed",
                        },
                    )
                    continue

                serialized_result = (
                    serialize_pipeline_result(pipeline_result)
                    if pipeline_result is not None
                    else {"idea_blocks": [], "task_items": []}
                )
                logger.info(
                    "pipeline_ws_generation_done session_name=%s participant_id=%s idea_blocks=%s task_items=%s",
                    session_name,
                    participant_id,
                    len(serialized_result["idea_blocks"]),
                    len(serialized_result["task_items"]),
                )
                await send_ws_json_safe(
                    websocket,
                    {
                        "type": "idea_blocks_update",
                        "idea_blocks": serialized_result["idea_blocks"],
                    },
                )
                await send_ws_json_safe(
                    websocket,
                    {
                        "type": "task_items_update",
                        "task_items": serialized_result["task_items"],
                    },
                )

        except WebSocketDisconnect:
            logger.info(
                "pipeline_ws_disconnected session_name=%s participant_id=%s",
                session_name,
                participant_id,
            )
            return
        except Exception as exc:
            logger.exception("pipeline_ws_unhandled_error session_name=%s participant_id=%s error=%s", session_name, participant_id, exc)
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close(code=1011)


def _participant_id_to_int(participant_id: str) -> int:
    try:
        return int(participant_id)
    except (TypeError, ValueError):
        return 0
