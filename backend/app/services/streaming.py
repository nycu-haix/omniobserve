import asyncio
import json
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..config import STREAM_MIN_FINAL_SECONDS, STREAM_STEP_SECONDS, STREAM_WINDOW_SECONDS, logger
from ..db import SessionLocal
from ..models import Visibility
from ..schemas import StreamContext, StreamTranscript
from ..task_config import resolve_task_id
from ..task_config.registry import normalize_task_name
from ..utils import utc_now
from .asr import transcribe_ws_chunk
from .board_payloads import serialize_frontend_board_idea_block, serialize_frontend_board_idea_block_update
from .participant_status import mark_audio_disconnected, update_audio_status
from .realtime import board_manager, broadcast_admin_idea_blocks_update, broadcast_admin_transcript, broadcast_presence_state, broadcast_public_transcript_line
from .transcript_pipeline import handle_transcript_segment, serialize_idea_blocks, serialize_pipeline_result
from .transcripts import save_ws_transcript_segment

LIVE_TRANSCRIPT_REASON = "sliding_window"
_SILENCE_ENERGY_THRESHOLD = 300.0  # int16 RMS (0-32768 scale)
_SILENCE_DURATION_SECONDS = 2.0


def _resolve_stream_task_name(session_name: str, task_name: str | None) -> str:
    if task_name is not None:
        return normalize_task_name(task_name)
    return resolve_task_id(session_name=session_name)


def _bounded_stream_seconds(value: float, *, default: float, minimum: float) -> float:
    if value <= 0:
        return default
    return max(value, minimum)


def _stream_window_samples(sample_rate: int) -> int:
    seconds = _bounded_stream_seconds(STREAM_WINDOW_SECONDS, default=4.0, minimum=0.5)
    return max(int(round(sample_rate * seconds)), 1)


def _stream_step_samples(sample_rate: int) -> int:
    window_samples = _stream_window_samples(sample_rate)
    seconds = _bounded_stream_seconds(STREAM_STEP_SECONDS, default=2.0, minimum=0.25)
    return max(1, min(int(round(sample_rate * seconds)), window_samples))


def _stream_min_final_samples(sample_rate: int) -> int:
    seconds = _bounded_stream_seconds(STREAM_MIN_FINAL_SECONDS, default=0.8, minimum=0.1)
    return max(1, int(round(sample_rate * seconds)))


def merge_transcript_text(previous_text: str, next_text: str) -> str:
    previous = previous_text.strip()
    next_value = next_text.strip()
    if not previous:
        return next_value
    if not next_value:
        return previous
    if previous.endswith(next_value) or next_value in previous:
        return collapse_repeated_transcript_tail(previous)
    if next_value.startswith(previous) or previous in next_value:
        return collapse_repeated_transcript_tail(next_value)

    max_overlap = min(len(previous), len(next_value))
    for overlap in range(max_overlap, 1, -1):
        if previous[-overlap:] == next_value[:overlap]:
            return collapse_repeated_transcript_tail(f"{previous}{next_value[overlap:]}")

    return collapse_repeated_transcript_tail(f"{previous}{next_value}")


def merge_transcript_segments(texts: list[str]) -> str:
    merged_text = ""
    for text in texts:
        merged_text = merge_transcript_text(merged_text, text)
    return merged_text.strip()


def collapse_repeated_transcript_tail(text: str) -> str:
    cleaned = text.strip()
    max_unit_length = min(len(cleaned) // 2, 80)
    for unit_length in range(max_unit_length, 3, -1):
        unit = cleaned[-unit_length:]
        if not unit.strip():
            continue
        prefix = cleaned[: -unit_length]
        repeats = 1
        while prefix.endswith(unit):
            repeats += 1
            prefix = prefix[: -unit_length]
        if repeats > 1:
            return collapse_repeated_transcript_tail(f"{prefix}{unit}")
    return cleaned


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
    if (
        websocket.client_state != WebSocketState.CONNECTED
        or websocket.application_state != WebSocketState.CONNECTED
    ):
        return
    try:
        await websocket.send_json(payload)
    except Exception as exc:
        logger.warning("Failed to send WebSocket message: %s", exc)


async def close_ws_safe(websocket: WebSocket, *, code: int = 1000) -> None:
    if (
        websocket.client_state != WebSocketState.CONNECTED
        or websocket.application_state != WebSocketState.CONNECTED
    ):
        return
    try:
        await websocket.close(code=code)
    except Exception as exc:
        logger.warning("Failed to close WebSocket safely: %s", exc)


async def send_similarity_idea_blocks_update(websocket: WebSocket, *, session_name: str, participant_id: str, idea_blocks: list[Any]) -> None:
    logger.info(
        "similarity_detection_ws_patch_send idea_blocks=%s",
        len(idea_blocks),
    )
    serialized_idea_blocks = serialize_idea_blocks(idea_blocks)
    await send_ws_json_safe(
        websocket,
        {
            "type": "idea_blocks_update",
            "idea_blocks": serialized_idea_blocks,
            "scope": "similarity",
            "participant_id": participant_id,
        },
    )
    await broadcast_admin_idea_blocks_update(
        session_name,
        participant_id=participant_id,
        idea_blocks=serialized_idea_blocks,
    )


async def send_provisional_idea_blocks_update(
    websocket: WebSocket,
    *,
    participant_id: str,
    provisional_idea_blocks: list[dict[str, Any]],
    scope: str,
    transcript_segment_id: str | None = None,
    transcript_segment_ids: list[str] | None = None,
    client_segment_id: str | None = None,
    client_segment_ids: list[str] | None = None,
) -> None:
    if not provisional_idea_blocks:
        return

    await send_ws_json_safe(
        websocket,
        {
            "type": "idea_blocks_provisional_update",
            "provisional_idea_blocks": provisional_idea_blocks,
            "scope": scope,
            "participant_id": participant_id,
            "transcript_segment_id": transcript_segment_id,
            "transcript_segment_ids": transcript_segment_ids or [],
            "client_segment_id": client_segment_id,
            "client_segment_ids": client_segment_ids or [],
            "generation_complete": False,
        },
    )


async def send_board_idea_blocks_update(
    *,
    session_name: str,
    participant_id: str,
    idea_blocks: list[Any],
    duplicate_idea_blocks: list[Any],
    scope: str,
    transcript_segment_id: str | int | None = None,
    transcript_segment_ids: list[str] | None = None,
    client_segment_id: str | None = None,
    client_segment_ids: list[str] | None = None,
) -> None:
    completion_metadata = {
        "scope": scope,
        "participant_id": participant_id,
        "transcript_segment_id": transcript_segment_id,
        "transcript_segment_ids": transcript_segment_ids or [],
        "client_segment_id": client_segment_id,
        "client_segment_ids": client_segment_ids or [],
        "generation_complete": True,
    }
    sent_count = 0
    for idea_block in idea_blocks:
        if await board_manager.send_to(
            session_name,
            participant_id,
            {
                "type": "new_idea_block",
                "payload": serialize_frontend_board_idea_block(idea_block),
                **completion_metadata,
            },
        ):
            sent_count += 1

    for duplicate_idea_block in duplicate_idea_blocks:
        await board_manager.send_to(
            session_name,
            participant_id,
            {
                "type": "update_idea_block",
                "payload": serialize_frontend_board_idea_block_update(duplicate_idea_block),
                **completion_metadata,
            },
        )

    logger.info(
        "pipeline_board_idea_blocks_update_sent session_name=%s participant_id=%s idea_blocks=%s duplicate_idea_blocks=%s sent=%s",
        session_name,
        participant_id,
        len(idea_blocks),
        len(duplicate_idea_blocks),
        sent_count,
    )


async def handle_audio_stream_websocket(
    websocket: WebSocket,
    *,
    session_name: str,
    participant_id: str,
    task_name: str | None = None,
) -> None:
    task_name = _resolve_stream_task_name(session_name, task_name)
    await websocket.accept()

    stream_context: StreamContext | None = None
    transcript_segments: list[StreamTranscript] = []
    int16_buffer = np.empty(0, dtype=np.int16)
    buffer_start_sample = 0
    total_samples_received = 0
    next_window_start_sample = 0
    first_audio_received_at: datetime | None = None
    merged_transcript_text = ""
    last_sent_live_text = ""
    final_transcript_saved = False
    stop_received = False
    silence_start_at: datetime | None = None
    segment_started_at: datetime | None = None
    segment_index = 0

    async with SessionLocal() as db:

        def sample_timestamp(sample_index: int) -> datetime:
            if stream_context is None or first_audio_received_at is None:
                return utc_now()
            return first_audio_received_at + timedelta(
                seconds=sample_index / max(stream_context.sample_rate, 1)
            )

        def trim_processed_audio() -> None:
            nonlocal int16_buffer, buffer_start_sample
            trim_samples = next_window_start_sample - buffer_start_sample
            if trim_samples <= 0:
                return
            trim_samples = min(trim_samples, int16_buffer.size)
            int16_buffer = int16_buffer[trim_samples:].copy()
            buffer_start_sample += trim_samples

        async def send_live_transcript(*, started_at: datetime, ended_at: datetime) -> None:
            if stream_context is None or not merged_transcript_text.strip():
                return
            timestamp_ms = int(ended_at.timestamp() * 1000)
            payload = {
                "type": "transcript",
                "text": merged_transcript_text.strip(),
                "participant_id": participant_id,
                "segment_id": f"live-{participant_id}",
                "scope": stream_context.scope.value,
                "is_final": False,
                "reason": LIVE_TRANSCRIPT_REASON,
                "persisted": False,
                "timestamp_ms": timestamp_ms,
                "window_started_at": started_at.isoformat(),
                "window_ended_at": ended_at.isoformat(),
            }
            await send_ws_json_safe(websocket, payload)
            await broadcast_admin_transcript(
                session_name,
                participant_id=participant_id,
                scope=stream_context.scope.value,
                text=merged_transcript_text.strip(),
                is_final=False,
                persisted=False,
                transcript_segment_id=None,
                reason=LIVE_TRANSCRIPT_REASON,
            )

        async def process_audio_buffer(force: bool) -> None:
            nonlocal int16_buffer, next_window_start_sample, merged_transcript_text, last_sent_live_text
            if stream_context is None:
                return
            if first_audio_received_at is None or int16_buffer.size == 0:
                return

            sample_rate = max(stream_context.sample_rate, 1)
            window_samples = _stream_window_samples(sample_rate)
            step_samples = _stream_step_samples(sample_rate)
            min_final_samples = _stream_min_final_samples(sample_rate)

            while True:
                available_end_sample = buffer_start_sample + int16_buffer.size
                remaining_samples = available_end_sample - next_window_start_sample

                if remaining_samples >= window_samples:
                    chunk_samples = window_samples
                elif force and remaining_samples >= min_final_samples:
                    chunk_samples = remaining_samples
                else:
                    break

                buffer_offset = max(0, next_window_start_sample - buffer_start_sample)
                chunk = int16_buffer[buffer_offset : buffer_offset + chunk_samples].copy()
                if chunk.size == 0:
                    break

                chunk_start_sample = next_window_start_sample
                chunk_end_sample = chunk_start_sample + chunk.size
                chunk_started_at = sample_timestamp(chunk_start_sample)
                chunk_ended_at = sample_timestamp(chunk_end_sample)

                transcript_text = await transcribe_ws_chunk(
                    pcm16_bytes=chunk.tobytes(),
                    sample_rate=stream_context.sample_rate,
                    channels=stream_context.channels,
                )
                if transcript_text:
                    merged_transcript_text = merge_transcript_text(merged_transcript_text, transcript_text)
                    if merged_transcript_text.strip() != last_sent_live_text:
                        last_sent_live_text = merged_transcript_text.strip()
                        await send_live_transcript(
                            started_at=chunk_started_at,
                            ended_at=chunk_ended_at,
                        )

                next_window_start_sample = chunk_end_sample if force else chunk_start_sample + step_samples
                trim_processed_audio()

                if force:
                    break

        async def finalize_stream_transcript() -> StreamTranscript | None:
            nonlocal final_transcript_saved
            if final_transcript_saved:
                return transcript_segments[-1] if transcript_segments else None

            await process_audio_buffer(force=True)
            final_text = merged_transcript_text.strip()
            final_transcript_saved = True

            if stream_context is None or not final_text:
                return None

            sample_rate = max(stream_context.sample_rate, 1)
            started_at = first_audio_received_at or utc_now()
            ended_at = started_at + timedelta(seconds=total_samples_received / sample_rate)
            visibility = stream_context.scope if stream_context.scope == Visibility.PRIVATE else Visibility.PUBLIC
            saved_segment = await save_ws_transcript_segment(
                db,
                session_name=session_name,
                participant_id=participant_id,
                visibility=visibility,
                transcript_text=final_text,
                started_at=started_at,
                ended_at=ended_at,
                display_name=str(stream_context.start_message.get("displayName") or "").strip() or None,
            )
            if saved_segment:
                transcript_segments.append(saved_segment)
            return saved_segment

        async def finalize_silence_segment() -> StreamTranscript | None:
            nonlocal merged_transcript_text, last_sent_live_text, next_window_start_sample
            nonlocal silence_start_at, segment_started_at, segment_index

            await process_audio_buffer(force=True)
            final_text = merged_transcript_text.strip()
            seg_started_at = segment_started_at or first_audio_received_at or utc_now()
            ended_at = utc_now()

            # Reset state for next segment before any awaits that could interleave
            merged_transcript_text = ""
            last_sent_live_text = ""
            next_window_start_sample = buffer_start_sample + int16_buffer.size
            trim_processed_audio()
            silence_start_at = None
            segment_started_at = None

            if not final_text or stream_context is None:
                return None

            visibility = stream_context.scope if stream_context.scope == Visibility.PRIVATE else Visibility.PUBLIC
            saved_segment = await save_ws_transcript_segment(
                db,
                session_name=session_name,
                participant_id=participant_id,
                visibility=visibility,
                transcript_text=final_text,
                started_at=seg_started_at,
                ended_at=ended_at,
                display_name=str(stream_context.start_message.get("displayName") or "").strip() or None,
            )
            if saved_segment:
                transcript_segments.append(saved_segment)

            segment_id = saved_segment.segment_id if saved_segment else f"silence-{segment_index}"
            timestamp_ms = int(ended_at.timestamp() * 1000)
            await send_ws_json_safe(websocket, {
                "type": "transcript",
                "text": final_text,
                "participant_id": participant_id,
                "segment_id": str(segment_id),
                "scope": stream_context.scope.value,
                "is_final": True,
                "reason": "silence",
                "persisted": None,
                "timestamp_ms": timestamp_ms,
            })
            await broadcast_admin_transcript(
                session_name,
                participant_id=participant_id,
                scope=stream_context.scope.value,
                text=final_text,
                is_final=True,
                persisted=saved_segment is not None,
                transcript_segment_id=str(segment_id),
                reason="silence",
            )
            if stream_context.scope != Visibility.PRIVATE:
                await broadcast_public_transcript_line(
                    session_name,
                    participant_id=participant_id,
                    text=final_text,
                    transcript_segment_id=str(segment_id),
                )

            segment_index += 1
            return saved_segment

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
            update_audio_status(
                session_name,
                participant_id,
                mic_mode=stream_context.scope.value,
                audio_connected=True,
                display_name=str(stream_context.start_message.get("displayName") or "") or None,
                client_id=stream_context.client_id,
            )
            await broadcast_presence_state(session_name)
        except WebSocketDisconnect:
            return
        except Exception as exc:
            logger.warning("Invalid start message for audio stream: %s", exc)
            await close_ws_safe(websocket, code=1003)
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

                    if first_audio_received_at is None:
                        first_audio_received_at = utc_now()

                    if int16_buffer.size == 0:
                        buffer_start_sample = total_samples_received
                        int16_buffer = int16_array
                    else:
                        int16_buffer = np.concatenate((int16_buffer, int16_array))
                    total_samples_received += int16_array.size

                    chunk_rms = float(np.sqrt(np.mean(int16_array.astype(np.float64) ** 2)))
                    if chunk_rms > _SILENCE_ENERGY_THRESHOLD:
                        silence_start_at = None
                        if segment_started_at is None:
                            segment_started_at = utc_now()
                    elif silence_start_at is None:
                        silence_start_at = utc_now()

                    if (
                        silence_start_at is not None
                        and merged_transcript_text
                        and (utc_now() - silence_start_at).total_seconds() >= _SILENCE_DURATION_SECONDS
                    ):
                        await finalize_silence_segment()
                        continue

                    await process_audio_buffer(force=False)
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
                    saved_final_segment = await finalize_stream_transcript()
                    completed_transcript_segment_ids = _transcript_segment_ids(transcript_segments)
                    pipeline_result = None
                    serialized_result = {"idea_blocks": [], "duplicate_idea_blocks": [], "task_items": []}
                    idea_blocks_payload: list[dict[str, Any]] = []
                    task_items_payload: list[dict[str, Any]] = []
                    if transcript_segments and stream_context.scope == Visibility.PRIVATE:
                        try:
                            pipeline_result = await handle_transcript_segment(
                                db,
                                session_name=session_name,
                                user_id=_participant_id_to_int(participant_id),
                                transcript=None,
                                is_final=True,
                                visibility=stream_context.scope,
                                task_name=task_name,
                                on_similarity_update=lambda idea_blocks: send_similarity_idea_blocks_update(
                                    websocket,
                                    session_name=session_name,
                                    participant_id=participant_id,
                                    idea_blocks=idea_blocks,
                                ),
                                on_provisional_idea_blocks_update=lambda provisional_idea_blocks: send_provisional_idea_blocks_update(
                                    websocket,
                                    participant_id=participant_id,
                                    provisional_idea_blocks=provisional_idea_blocks,
                                    scope=stream_context.scope.value,
                                    transcript_segment_id=saved_final_segment.segment_id if saved_final_segment else None,
                                    transcript_segment_ids=completed_transcript_segment_ids,
                                    client_segment_id=None,
                                    client_segment_ids=[],
                                ),
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
                                    "scope": stream_context.scope.value,
                                    "participant_id": participant_id,
                                    "transcript_segment_id": saved_final_segment.segment_id if saved_final_segment else None,
                                    "transcript_segment_ids": completed_transcript_segment_ids,
                                },
                            )
                            pipeline_result = None

                        if pipeline_result is not None:
                            serialized_result = serialize_pipeline_result(pipeline_result)
                            idea_blocks_payload = serialized_result["idea_blocks"]
                            task_items_payload = serialized_result["task_items"]

                    last_segment_id = saved_final_segment.segment_id if saved_final_segment else None
                    last_text = saved_final_segment.text if saved_final_segment else merged_transcript_text.strip()
                    final_persisted = saved_final_segment is not None
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "transcript_update",
                            "transcript_segment_id": last_segment_id,
                            "participant_id": participant_id,
                            "scope": stream_context.scope.value,
                            "text": last_text,
                            "is_final": True,
                            "persisted": final_persisted,
                            "client_segment_id": None,
                        },
                    )
                    if last_text:
                        await broadcast_admin_transcript(
                            session_name,
                            participant_id=participant_id,
                            scope=stream_context.scope.value,
                            text=last_text,
                            is_final=True,
                            persisted=final_persisted,
                            transcript_segment_id=last_segment_id,
                        )
                        if stream_context.scope != Visibility.PRIVATE:
                            await broadcast_public_transcript_line(
                                session_name,
                                participant_id=participant_id,
                                text=last_text,
                                transcript_segment_id=last_segment_id,
                            )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "idea_blocks_update",
                            "idea_blocks": idea_blocks_payload,
                            "duplicate_idea_blocks": serialized_result["duplicate_idea_blocks"],
                            "scope": stream_context.scope.value,
                            "participant_id": participant_id,
                            "transcript_segment_id": last_segment_id,
                            "transcript_segment_ids": completed_transcript_segment_ids,
                            "client_segment_id": None,
                            "generation_complete": stream_context.scope == Visibility.PRIVATE and bool(transcript_segments),
                        },
                    )
                    await broadcast_admin_idea_blocks_update(
                        session_name,
                        participant_id=participant_id,
                        idea_blocks=idea_blocks_payload,
                    )
                    if pipeline_result is not None:
                        await send_board_idea_blocks_update(
                            session_name=session_name,
                            participant_id=participant_id,
                            idea_blocks=pipeline_result.idea_blocks,
                            duplicate_idea_blocks=pipeline_result.duplicate_idea_blocks,
                            scope=stream_context.scope.value,
                            transcript_segment_id=last_segment_id,
                            transcript_segment_ids=completed_transcript_segment_ids,
                            client_segment_id=None,
                            client_segment_ids=[],
                        )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "task_items_update",
                            "task_items": task_items_payload,
                        },
                    )
                    await close_ws_safe(websocket)
                    return

        except WebSocketDisconnect:
            logger.info(
                "WebSocket disconnected unexpectedly, flushing buffered audio for session_name=%s participant_id=%s",
                session_name,
                participant_id,
            )
            await finalize_stream_transcript()
        except Exception as exc:
            logger.exception("Unhandled WebSocket audio stream error: %s", exc)
            await finalize_stream_transcript()
            await close_ws_safe(websocket, code=1011)
        finally:
            mark_audio_disconnected(session_name, participant_id)
            await broadcast_presence_state(session_name)
            if not stop_received:
                # Keep connection open unless stop arrives; close only in error paths above.
                await close_ws_safe(websocket)


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
_pending_transcript_batch_client_ids: dict[tuple[str, str], list[str]] = defaultdict(list)
_pending_transcript_batch_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)
_persisted_client_segments: dict[tuple[str, str, str, str], tuple[str, str]] = {}
_MAX_PERSISTED_CLIENT_SEGMENTS = 10000


def _dedupe_ids(values: list[str | None]) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ids.append(normalized)
    return ids


def _transcript_segment_ids(transcripts: list[StreamTranscript]) -> list[str]:
    return _dedupe_ids([str(transcript.segment_id) for transcript in transcripts if transcript.segment_id is not None])


def _client_segment_cache_key(
    session_name: str,
    participant_id: str,
    visibility: Visibility,
    client_segment_id: str,
) -> tuple[str, str, str, str]:
    return (session_name, participant_id, visibility.value, client_segment_id)


def _remember_persisted_client_segment(
    key: tuple[str, str, str, str],
    segment_id: str,
    text: str,
) -> None:
    _persisted_client_segments[key] = (segment_id, text)
    while len(_persisted_client_segments) > _MAX_PERSISTED_CLIENT_SEGMENTS:
        _persisted_client_segments.pop(next(iter(_persisted_client_segments)))


async def handle_transcript_segments_websocket(
    websocket: WebSocket,
    *,
    session_name: str,
    participant_id: str,
    task_name: str | None = None,
) -> None:
    task_name = _resolve_stream_task_name(session_name, task_name)
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
                    await close_ws_safe(websocket)
                    return
                if message_type != "transcript_segment":
                    logger.info(
                        "pipeline_ws_skip_message_type session_name=%s participant_id=%s message_type=%s",
                        session_name,
                        participant_id,
                        message_type,
                    )
                    continue

                text = str(payload.get("text") or "").strip()
                reason = str(payload.get("reason") or "").strip().lower()
                visibility = _normalize_visibility(payload.get("scope") or payload.get("visibility") or "private")
                retranscribed_final = payload.get("retranscribedFinal") is True
                client_segment_id = str(payload.get("client_segment_id") or "").strip()
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
                if visibility != Visibility.PRIVATE:
                    logger.info(
                        "pipeline_ws_skip_non_private session_name=%s participant_id=%s reason=%s visibility=%s chars=%s",
                        session_name,
                        participant_id,
                        reason or "unknown",
                        visibility.value,
                        len(text),
                    )
                    segment_id = None
                    is_final = reason in FINAL_TRANSCRIPT_REASONS
                    cache_key = (
                        _client_segment_cache_key(
                            session_name,
                            participant_id,
                            Visibility.PUBLIC,
                            client_segment_id,
                        )
                        if is_final and client_segment_id
                        else None
                    )
                    cached_segment = _persisted_client_segments.get(cache_key) if cache_key else None
                    if is_final:
                        if cached_segment is not None:
                            segment_id, text = cached_segment
                            logger.info(
                                "pipeline_ws_public_final_reused session_name=%s participant_id=%s client_segment_id=%s transcript_id=%s",
                                session_name,
                                participant_id,
                                client_segment_id,
                                segment_id,
                            )
                        else:
                            timestamp = _timestamp_from_seconds(payload.get("start"))
                            saved_segment = await save_ws_transcript_segment(
                                db,
                                session_name=session_name,
                                participant_id=participant_id,
                                visibility=Visibility.PUBLIC,
                                transcript_text=text,
                                started_at=timestamp,
                                ended_at=timestamp,
                                display_name=str(payload.get("displayName") or payload.get("display_name") or "").strip() or None,
                            )
                            segment_id = saved_segment.segment_id if saved_segment else None
                            if cache_key and segment_id is not None:
                                _remember_persisted_client_segment(cache_key, segment_id, text)
                    if not is_final:
                        await send_ws_json_safe(
                            websocket,
                            {
                                "type": "transcript",
                                "participant_id": participant_id,
                                "scope": visibility.value,
                                "segment_id": None,
                                "text": text,
                                "is_final": False,
                                "reason": reason,
                                "persisted": False,
                            },
                        )
                    if reason in FINAL_TRANSCRIPT_REASONS:
                        if segment_id is None:
                            await send_ws_json_safe(
                                websocket,
                                {
                                    "type": "transcript_error",
                                    "reason": "save_failed",
                                    "scope": visibility.value,
                                    "participant_id": participant_id,
                                    "client_segment_id": client_segment_id or None,
                                },
                            )
                            continue
                        await send_ws_json_safe(
                            websocket,
                            {
                                "type": "transcript_update",
                                "transcript_segment_id": segment_id,
                                "participant_id": participant_id,
                                "scope": visibility.value,
                                "text": text,
                                "is_final": True,
                                "reason": reason,
                                "persisted": True,
                                "client_segment_id": client_segment_id or None,
                            },
                        )
                    if reason in FINAL_TRANSCRIPT_REASONS:
                        if cached_segment is None:
                            await broadcast_public_transcript_line(
                                session_name,
                                participant_id=participant_id,
                                text=text,
                                transcript_segment_id=segment_id,
                            )
                        await send_ws_json_safe(
                            websocket,
                            {
                                "type": "idea_blocks_update",
                                "idea_blocks": [],
                                "duplicate_idea_blocks": [],
                                "scope": visibility.value,
                                "participant_id": participant_id,
                                "transcript_segment_id": segment_id,
                                "transcript_segment_ids": [str(segment_id)],
                                "client_segment_id": client_segment_id or None,
                                "client_segment_ids": _dedupe_ids([client_segment_id]),
                            },
                        )
                        await send_ws_json_safe(websocket, {"type": "task_items_update", "task_items": []})
                    continue

                cache_key = (
                    _client_segment_cache_key(
                        session_name,
                        participant_id,
                        visibility,
                        client_segment_id,
                    )
                    if reason in FINAL_TRANSCRIPT_REASONS and client_segment_id
                    else None
                )
                cached_segment = _persisted_client_segments.get(cache_key) if cache_key else None
                if cached_segment is not None:
                    cached_segment_id, cached_text = cached_segment
                    logger.info(
                        "pipeline_ws_private_final_reused session_name=%s participant_id=%s client_segment_id=%s transcript_id=%s",
                        session_name,
                        participant_id,
                        client_segment_id,
                        cached_segment_id,
                    )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "transcript_update",
                            "transcript_segment_id": cached_segment_id,
                            "participant_id": participant_id,
                            "scope": visibility.value,
                            "text": cached_text,
                            "is_final": True,
                            "reason": reason,
                            "persisted": True,
                            "client_segment_id": client_segment_id or None,
                        },
                    )
                    await send_ws_json_safe(
                        websocket,
                        {
                            "type": "idea_blocks_update",
                            "idea_blocks": [],
                            "duplicate_idea_blocks": [],
                            "scope": visibility.value,
                            "participant_id": participant_id,
                            "transcript_segment_id": cached_segment_id,
                            "transcript_segment_ids": [str(cached_segment_id)],
                            "client_segment_id": client_segment_id or None,
                            "client_segment_ids": _dedupe_ids([client_segment_id]),
                            "generation_complete": True,
                        },
                    )
                    await send_ws_json_safe(websocket, {"type": "task_items_update", "task_items": []})
                    continue

                batch_texts: list[str] | None = None
                batch_client_segment_ids: list[str] = []
                batch_text = ""
                async with _pending_transcript_batch_locks[batch_key]:
                    if reason == "max_speech_ms":
                        _pending_transcript_batch_texts[batch_key].append(text)
                        if client_segment_id:
                            _pending_transcript_batch_client_ids[batch_key].append(client_segment_id)
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
                                "participant_id": participant_id,
                                "scope": visibility.value,
                                "segment_id": client_segment_id or None,
                                "text": text,
                                "is_final": False,
                                "reason": reason,
                                "persisted": False,
                                "client_segment_id": client_segment_id or None,
                                "client_segment_ids": _dedupe_ids([client_segment_id]),
                            },
                        )
                        continue

                    if reason in FINAL_TRANSCRIPT_REASONS:
                        pending_client_segment_ids = list(_pending_transcript_batch_client_ids.pop(batch_key, []))
                        if retranscribed_final:
                            batch_texts = list(_pending_transcript_batch_texts.pop(batch_key, []))
                            batch_text = text
                            batch_client_segment_ids = _dedupe_ids([*pending_client_segment_ids, client_segment_id])
                        else:
                            _pending_transcript_batch_texts[batch_key].append(text)
                            batch_texts = list(_pending_transcript_batch_texts.pop(batch_key, []))
                            batch_client_segment_ids = _dedupe_ids([*pending_client_segment_ids, client_segment_id])
                            batch_text = merge_transcript_segments(batch_texts)
                        logger.info(
                            "pipeline_ws_batch_final session_name=%s participant_id=%s reason=%s retranscribed_final=%s batch_segments=%s batch_chars=%s",
                            session_name,
                            participant_id,
                            reason,
                            retranscribed_final,
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
                    display_name=str(payload.get("displayName") or payload.get("display_name") or "").strip() or None,
                )

                if saved_segment is None:
                    async with _pending_transcript_batch_locks[batch_key]:
                        _pending_transcript_batch_texts[batch_key] = batch_texts or []
                        _pending_transcript_batch_client_ids[batch_key] = batch_client_segment_ids
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
                            "scope": visibility.value,
                            "participant_id": participant_id,
                            "client_segment_id": client_segment_id or None,
                            "client_segment_ids": batch_client_segment_ids,
                        },
                    )
                    continue

                if cache_key:
                    _remember_persisted_client_segment(
                        cache_key,
                        saved_segment.segment_id,
                        saved_segment.text,
                    )

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
                        "participant_id": participant_id,
                        "scope": visibility.value,
                        "text": saved_segment.text,
                        "is_final": True,
                        "reason": reason,
                        "persisted": True,
                        "client_segment_id": client_segment_id or None,
                        "client_segment_ids": batch_client_segment_ids,
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
                        task_name=task_name,
                        on_similarity_update=lambda idea_blocks: send_similarity_idea_blocks_update(
                            websocket,
                            session_name=session_name,
                            participant_id=participant_id,
                            idea_blocks=idea_blocks,
                        ),
                        on_provisional_idea_blocks_update=lambda provisional_idea_blocks: send_provisional_idea_blocks_update(
                            websocket,
                            participant_id=participant_id,
                            provisional_idea_blocks=provisional_idea_blocks,
                            scope=visibility.value,
                            transcript_segment_id=saved_segment.segment_id,
                            transcript_segment_ids=[str(saved_segment.segment_id)],
                            client_segment_id=client_segment_id or None,
                            client_segment_ids=batch_client_segment_ids,
                        ),
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
                            "scope": visibility.value,
                            "participant_id": participant_id,
                            "transcript_segment_id": saved_segment.segment_id,
                            "transcript_segment_ids": [str(saved_segment.segment_id)],
                            "client_segment_id": client_segment_id or None,
                            "client_segment_ids": batch_client_segment_ids,
                        },
                    )
                    continue

                serialized_result = (
                    serialize_pipeline_result(pipeline_result)
                    if pipeline_result is not None
                    else {"idea_blocks": [], "duplicate_idea_blocks": [], "task_items": []}
                )
                logger.info(
                    "pipeline_ws_generation_done session_name=%s participant_id=%s idea_blocks=%s task_items=%s",
                    session_name,
                    participant_id,
                    len(serialized_result["idea_blocks"]),
                    len(serialized_result["task_items"]),
                )
                logger.info(
                    "pipeline_ws_send_idea_blocks_update session_name=%s participant_id=%s idea_blocks=%s",
                    session_name,
                    participant_id,
                    len(serialized_result["idea_blocks"]),
                )
                await send_ws_json_safe(
                    websocket,
                    {
                        "type": "idea_blocks_update",
                        "idea_blocks": serialized_result["idea_blocks"],
                        "duplicate_idea_blocks": serialized_result["duplicate_idea_blocks"],
                        "scope": visibility.value,
                        "participant_id": participant_id,
                        "transcript_segment_id": saved_segment.segment_id,
                        "transcript_segment_ids": [str(saved_segment.segment_id)],
                        "client_segment_id": client_segment_id or None,
                        "client_segment_ids": batch_client_segment_ids,
                        "generation_complete": True,
                    },
                )
                await broadcast_admin_idea_blocks_update(
                    session_name,
                    participant_id=participant_id,
                    idea_blocks=serialized_result["idea_blocks"],
                )
                if pipeline_result is not None:
                    await send_board_idea_blocks_update(
                        session_name=session_name,
                        participant_id=participant_id,
                        idea_blocks=pipeline_result.idea_blocks,
                        duplicate_idea_blocks=pipeline_result.duplicate_idea_blocks,
                        scope=visibility.value,
                        transcript_segment_id=saved_segment.segment_id,
                        transcript_segment_ids=[str(saved_segment.segment_id)],
                        client_segment_id=client_segment_id or None,
                        client_segment_ids=batch_client_segment_ids,
                    )
                logger.info(
                    "pipeline_ws_send_task_items_update session_name=%s participant_id=%s task_items=%s",
                    session_name,
                    participant_id,
                    len(serialized_result["task_items"]),
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
        except RuntimeError as exc:
            if "WebSocket is not connected" in str(exc) or "Cannot call \"receive\"" in str(exc):
                logger.info(
                    "pipeline_ws_disconnected_runtime session_name=%s participant_id=%s error=%s",
                    session_name,
                    participant_id,
                    exc,
                )
                return
            raise
        except Exception as exc:
            logger.exception("pipeline_ws_unhandled_error session_name=%s participant_id=%s error=%s", session_name, participant_id, exc)
            await close_ws_safe(websocket, code=1011)


def _participant_id_to_int(participant_id: str) -> int:
    try:
        return int(participant_id)
    except (TypeError, ValueError):
        return 0
