from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
import wave
from collections import deque
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlencode

import numpy as np
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse
# from transcript_normalizer import to_traditional

ASR_ENGINE = os.getenv("ASR_ENGINE", "whisperlivekit").strip().lower()
if ASR_ENGINE == "local":
    import torch
    from transformers import WhisperProcessor, WhisperForConditionalGeneration
else:
    torch = None
    WhisperProcessor = None
    WhisperForConditionalGeneration = None

app = FastAPI()

# =========================
# Paths
# =========================

BASE_DIR = Path(__file__).resolve().parent

@app.get("/", response_class=HTMLResponse)
async def diagnostic_index():
    return HTMLResponse((BASE_DIR / "diagnostic_index.html").read_text(encoding="utf-8"))


@app.get("/healthz")
async def health_check():
    return {"status": "ok"}

# =========================
# Audio / VAD config
# =========================

SAMPLE_RATE = 16000
CHUNK_SIZE = 512

START_THRESHOLD = 0.4
END_THRESHOLD = 0.15

MIN_SILENCE_MS = 1200
MIN_SPEECH_MS = 1000
MAX_SPEECH_MS = 10000

MIN_SILENCE_CHUNKS = int((MIN_SILENCE_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)
MIN_SPEECH_CHUNKS = int((MIN_SPEECH_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)
MAX_SPEECH_CHUNKS = int((MAX_SPEECH_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)

PRE_BUFFER_MS = 500
PRE_BUFFER_CHUNKS = int((PRE_BUFFER_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)

RMS_SILENCE_THRESHOLD = 0.00005
MIN_SAVE_DURATION_SEC = 0.8
LIVE_TRANSCRIPT_REASON = "sliding_window"
STREAM_WINDOW_SECONDS = float(os.getenv("STREAM_WINDOW_SECONDS", "4"))
STREAM_STEP_SECONDS = float(os.getenv("STREAM_STEP_SECONDS", "2"))
STREAM_WINDOW_SAMPLES = max(CHUNK_SIZE, int(round(STREAM_WINDOW_SECONDS * SAMPLE_RATE)))
STREAM_STEP_CHUNKS = max(1, int(round(STREAM_STEP_SECONDS * SAMPLE_RATE / CHUNK_SIZE)))
STREAM_MIN_LIVE_CHUNKS = max(MIN_SPEECH_CHUNKS, int(round(MIN_SAVE_DURATION_SEC * SAMPLE_RATE / CHUNK_SIZE)))

SEGMENT_DIR = BASE_DIR / "segments"
SEGMENT_DIR.mkdir(exist_ok=True)

TRANSCRIPT_FILE = BASE_DIR / "transcripts.jsonl"
PIPELINE_WS_BASE_URL = os.getenv("PIPELINE_WS_BASE_URL", "wss://api.omni.elvismao.com").rstrip("/")
PIPELINE_WS_TIMEOUT_SEC = float(os.getenv("PIPELINE_WS_TIMEOUT_SEC", "60"))
PIPELINE_FINAL_REASONS = {"silence", "client_stop", "mic_mode_switch", "disconnect"}
ASR_MOCK = os.getenv("ASR_MOCK", "0").strip().lower() in {"1", "true", "yes", "on"}
ASR_MODEL_NAME = os.getenv("ASR_MODEL_NAME", "MediaTek-Research/Breeze-ASR-25").strip()
WHISPERLIVEKIT_WS_URL = os.getenv("WHISPERLIVEKIT_WS_URL", "ws://whisperlivekit:8000/asr").strip()
WHISPERLIVEKIT_MODE = os.getenv("WHISPERLIVEKIT_MODE", "full").strip()
WHISPERLIVEKIT_FINAL_SILENCE_SEC = float(os.getenv("WHISPERLIVEKIT_FINAL_SILENCE_SEC", "2.0"))
ASR_MARKER_PATTERN = re.compile(
    r"\s*(?:"
    r"\[(?:聽不清|听不清|不清楚|無法辨識|无法辨识|噪音|雜音|杂音|音樂|音乐|笑聲|笑声|掌聲|掌声)\]"
    r"|[（(](?:台語|臺語|台语|閩南語|闽南语|客語|客家話|粵語|粤语|廣東話|广东话|英文|英語|中文|普通話|國語|国语|日語|韓語)[）)]"
    r")\s*"
)


@app.get("/asr-status")
async def asr_status():
    return {
        "engine": ASR_ENGINE,
        "mock": ASR_MOCK,
        "model": ASR_MODEL_NAME,
        "device": str(asr_device) if ASR_ENGINE == "local" else None,
        "whisperlivekit_ws_url": WHISPERLIVEKIT_WS_URL if ASR_ENGINE != "local" else None,
    }

# Clear old wav / transcript files on backend startup
def clear_output_files():
    deleted_wav_count = 0

    SEGMENT_DIR.mkdir(exist_ok=True)

    for wav_file in SEGMENT_DIR.glob("*.wav"):
        try:
            wav_file.unlink()
            deleted_wav_count += 1
        except Exception as e:
            print(f"Failed to delete wav {wav_file}: {e}")

    transcript_deleted = False

    if TRANSCRIPT_FILE.exists():
        try:
            TRANSCRIPT_FILE.unlink()
            transcript_deleted = True
        except Exception as e:
            print(f"Failed to delete transcript file: {e}")

    # print(
    #     f"Cleared output files: "
    #     f"deleted_wav_count={deleted_wav_count}, "
    #     f"transcript_deleted={transcript_deleted}"
    # )

    return {
        "deletedWavCount": deleted_wav_count,
        "transcriptDeleted": transcript_deleted,
    }
clear_output_files()

# =========================
# Load Silero VAD
# =========================

if ASR_ENGINE == "local":
    print("Loading Silero VAD model...")

    vad_model, vad_utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False,
        trust_repo=True,
    )

    vad_model.eval()

    print("Silero VAD loaded")
else:
    vad_model = None
    vad_utils = None
    print(f"ASR_ENGINE={ASR_ENGINE}. Local Silero VAD loading is skipped.")

# =========================
# Load Breeze ASR
# =========================

def resolve_asr_device() -> torch.device:
    configured_device = os.getenv("ASR_DEVICE", "auto").strip().lower()

    if configured_device in ("", "auto"):
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if configured_device == "cuda":
        return torch.device("cuda:0")

    return torch.device(configured_device)

if ASR_ENGINE != "local":
    asr_device = "whisperlivekit"
    asr_processor = None
    asr_model = None
    print("Local Breeze ASR model loading is skipped; using WhisperLiveKit proxy.")
elif ASR_MOCK:
    asr_device = torch.device("cpu")
    asr_processor = None
    asr_model = None
    print("ASR_MOCK enabled. Breeze ASR model loading is skipped.")
else:
    asr_device = resolve_asr_device()

    if asr_device.type == "cuda":
        asr_dtype = torch.float16
        print("CUDA detected. Breeze ASR will run on GPU.")
    else:
        asr_dtype = torch.float32
        print("CUDA not detected. Breeze ASR will run on CPU. This may be slow.")

    print(f"Loading Breeze ASR from Hugging Face cache: {ASR_MODEL_NAME}")

    asr_processor = WhisperProcessor.from_pretrained(ASR_MODEL_NAME)

    asr_model = WhisperForConditionalGeneration.from_pretrained(
        ASR_MODEL_NAME,
        torch_dtype=asr_dtype,
    ).to(asr_device)

    asr_model.eval()

    print(f"Breeze ASR loaded on {asr_device}")

# def resolve_asr_device() -> str:
#     configured_device = os.getenv("ASR_DEVICE", "auto").strip().lower()

#     if configured_device in ("", "auto"):
#         return "cuda:0" if torch.cuda.is_available() else "cpu"

#     if configured_device == "cuda":
#         return "cuda:0"

#     return configured_device


# def log_torch_runtime():
#     print(
#         "Torch runtime: "
#         f"version={torch.__version__}, "
#         f"cuda_build={torch.version.cuda}, "
#         f"cuda_available={torch.cuda.is_available()}"
#     )

#     if not torch.cuda.is_available():
#         return

#     try:
#         capability = torch.cuda.get_device_capability(0)
#         print(
#             "CUDA device: "
#             f"name={torch.cuda.get_device_name(0)}, "
#             f"capability=sm_{capability[0]}{capability[1]}, "
#             f"supported_arches={torch.cuda.get_arch_list()}"
#         )
#     except Exception as e:
#         print(f"Failed to inspect CUDA device: {e}")


# =========================
# Utility functions
# =========================

def sanitize_filename_part(value: Optional[str]) -> str:
    if value is None or value == "":
        return "unknown"

    safe = str(value)

    for ch in ['\\', '/', ':', '*', '?', '"', '<', '>', '|', ' ']:
        safe = safe.replace(ch, "_")

    return safe[:80]


def save_wav_float32(filename: Path, audio_float32: np.ndarray, sample_rate: int = SAMPLE_RATE):
    """
    Save mono float32 PCM audio as 16-bit PCM wav.
    """
    audio_float32 = np.asarray(audio_float32, dtype=np.float32)

    if len(audio_float32) == 0:
        return

    audio_float32 = np.clip(audio_float32, -1.0, 1.0)
    audio_int16 = (audio_float32 * 32767).astype(np.int16)

    with wave.open(str(filename), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_int16.tobytes())


def save_transcript_jsonl(
    file: str,
    start: float,
    end: float,
    duration: float,
    text: str,
    source: str = "unknown",
    scope: str = "unknown",
    agent_type: str = "unknown",
    room_name: Optional[str] = None,
    participant_id: Optional[str] = None,
    user_id: Optional[str] = None,
    display_name: Optional[str] = None,
    reason: Optional[str] = None,
):
    record = {
        # "source": source,
        "scope": scope,
        "agentType": agent_type,
        # "roomName": room_name,
        # "participantId": participant_id,
        # "userId": user_id,
        "displayName": display_name,
        # "file": file,
        # "start": round(start, 2),
        # "end": round(end, 2),
        # "duration": round(duration, 2),
        "reason": reason,
        "text": text,
    }

    with TRANSCRIPT_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def merge_transcript_text(previous_text: str, next_text: str) -> str:
    previous = previous_text.strip()
    next_value = next_text.strip()
    if not previous:
        return next_value
    if not next_value:
        return previous
    if previous.endswith(next_value) or next_value in previous:
        return previous
    if next_value.startswith(previous) or previous in next_value:
        return next_value

    max_overlap = min(len(previous), len(next_value))
    for overlap in range(max_overlap, 1, -1):
        if previous[-overlap:] == next_value[:overlap]:
            return f"{previous}{next_value[overlap:]}"

    return f"{previous}{next_value}"


def clean_asr_transcript_text(text: str) -> str:
    cleaned = ASR_MARKER_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()


async def relay_transcript_to_pipeline(
    websocket: WebSocket,
    send_lock: asyncio.Lock,
    *,
    text: str,
    reason: str,
    source: str,
    scope: str,
    agent_type: str,
    room_name: Optional[str],
    participant_id: Optional[str],
    user_id: Optional[str],
    display_name: Optional[str],
    start: float,
    end: float,
    duration: float,
    retranscribed_final: bool = False,
) -> list[dict]:
    if not PIPELINE_WS_BASE_URL:
        print("Pipeline relay skipped: PIPELINE_WS_BASE_URL is empty")
        return []

    if not text.strip() or not room_name:
        print(
            "Pipeline relay skipped: "
            f"has_text={bool(text.strip())}, roomName={room_name}"
        )
        return []

    relay_participant_id = participant_id or user_id or display_name
    if not relay_participant_id:
        print(
            "Pipeline relay skipped: "
            f"roomName={room_name}, participantId/userId/displayName missing"
        )
        return []

    url = (
        f"{PIPELINE_WS_BASE_URL}/ws/sessions/{quote(str(room_name), safe='')}"
        f"/transcript-segments?participant_id={quote(str(relay_participant_id), safe='')}"
    )
    payload = {
        "type": "transcript_segment",
        "scope": scope,
        "reason": reason,
        "text": text,
        "start": round(start, 2),
        "end": round(end, 2),
        "duration": round(duration, 2),
        "roomName": room_name,
        "participantId": participant_id,
        "userId": user_id,
        "displayName": display_name,
        "source": source,
        "agentType": agent_type,
        "retranscribedFinal": retranscribed_final,
    }
    terminal_types = (
        {"task_items_update", "pipeline_error"}
        if reason in PIPELINE_FINAL_REASONS
        else {"transcript", "pipeline_error"}
    )
    pipeline_messages = []

    try:
        print(
            "Pipeline relay sending: "
            f"roomName={room_name}, participantId={relay_participant_id}, "
            f"reason={reason}, scope={scope}, chars={len(text)}"
        )
        async with websockets.connect(url, max_size=None) as pipeline_ws:
            print(
                "Pipeline relay connected: "
                f"roomName={room_name}, participantId={relay_participant_id}, reason={reason}"
            )
            await pipeline_ws.send(json.dumps(payload, ensure_ascii=False))
            print(
                "Pipeline relay payload sent: "
                f"roomName={room_name}, participantId={relay_participant_id}, reason={reason}"
            )

            while True:
                raw_message = await asyncio.wait_for(
                    pipeline_ws.recv(),
                    timeout=PIPELINE_WS_TIMEOUT_SEC,
                )
                try:
                    message = json.loads(raw_message)
                except Exception:
                    continue

                message_type = message.get("type")
                if isinstance(message, dict) and message_type in {
                    "transcript_update",
                    "idea_blocks_update",
                    "task_items_update",
                    "pipeline_error",
                }:
                    pipeline_messages.append(message)
                    try:
                        async with send_lock:
                            await websocket.send_json(message)
                        print(
                            "Pipeline relay forwarded to client: "
                            f"roomName={room_name}, participantId={relay_participant_id}, "
                            f"reason={reason}, type={message_type}"
                        )
                    except Exception:
                        print(
                            "Cannot forward pipeline message because websocket is closed: "
                            f"type={message_type}"
                        )
                print(
                    "Pipeline relay received: "
                    f"roomName={room_name}, participantId={relay_participant_id}, "
                    f"reason={reason}, type={message_type}"
                )
                if message_type == "idea_blocks_update":
                    idea_blocks = message.get("idea_blocks")
                    print(
                        "Pipeline relay idea blocks update: "
                        f"count={len(idea_blocks) if isinstance(idea_blocks, list) else 0}"
                    )

                if message_type in terminal_types:
                    print(
                        "Pipeline relay completed: "
                        f"roomName={room_name}, participantId={relay_participant_id}, "
                        f"reason={reason}, response={message_type}"
                    )
                    return pipeline_messages
    except Exception as exc:
        print(
            "Pipeline relay failed: "
            f"roomName={room_name}, participantId={relay_participant_id}, "
            f"reason={reason}, error={exc}"
        )
        return pipeline_messages


def get_audio_stats(audio_chunk: np.ndarray):
    if len(audio_chunk) == 0:
        return 0.0, 0.0

    rms = float(np.sqrt(np.mean(audio_chunk ** 2)))
    peak = float(np.max(np.abs(audio_chunk)))

    return rms, peak


def decode_audio_bytes(
    pcm_bytes: bytes,
    encoding: str,
    input_sample_rate: int,
) -> np.ndarray:
    """
    Decode incoming binary audio to mono 16kHz float32 PCM.
    Supported:
      - float32: little-endian Float32 PCM
      - pcm_s16le: signed 16-bit little-endian PCM
    """
    if encoding == "float32":
        audio = np.frombuffer(pcm_bytes, dtype=np.float32).astype(np.float32, copy=False)

    elif encoding == "pcm_s16le":
        audio_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
        audio = audio_int16.astype(np.float32) / 32768.0

    else:
        raise ValueError(f"Unsupported encoding: {encoding}")

    if input_sample_rate != SAMPLE_RATE:
        audio = resample_to_16k(audio, input_sample_rate)

    audio = np.clip(audio, -1.0, 1.0).astype(np.float32, copy=False)

    return audio


def resample_to_16k(audio: np.ndarray, input_sample_rate: int) -> np.ndarray:
    """
    Lightweight linear resampler for simple testing.
    For production, prefer scipy.signal.resample_poly or torchaudio.
    """
    audio = np.asarray(audio, dtype=np.float32)

    if input_sample_rate == SAMPLE_RATE:
        return audio

    if len(audio) == 0:
        return audio

    duration = len(audio) / float(input_sample_rate)
    new_len = int(round(duration * SAMPLE_RATE))

    if new_len <= 0:
        return np.zeros(0, dtype=np.float32)

    old_x = np.linspace(0.0, duration, num=len(audio), endpoint=False)
    new_x = np.linspace(0.0, duration, num=new_len, endpoint=False)

    return np.interp(new_x, old_x, audio).astype(np.float32)


def transcribe_audio_float32(audio_float32: np.ndarray) -> str:
    """
    Transcribe 16kHz mono float32 audio using Breeze ASR 25.
    """
    audio_float32 = np.asarray(audio_float32, dtype=np.float32)

    if len(audio_float32) == 0:
        return ""

    audio_float32 = np.clip(audio_float32, -1.0, 1.0)

    segment_rms = float(np.sqrt(np.mean(audio_float32 ** 2)))
    segment_peak = float(np.max(np.abs(audio_float32)))

    # print(f"ASR input stats: rms={segment_rms:.6f}, peak={segment_peak:.6f}")

    # Avoid Whisper-like hallucination on almost-silent segments.
    if segment_rms < 0.0008:
        print("Skip ASR: segment rms too low")
        return ""

    if ASR_MOCK:
        return "local mock transcript"

    inputs = asr_processor(
        audio_float32,
        sampling_rate=SAMPLE_RATE,
        return_tensors="pt",
        return_attention_mask=True,
    )

    input_features = inputs.input_features.to(asr_device)

    if asr_device.type == "cuda":
        input_features = input_features.to(torch.float16)

    generate_kwargs = {
        "max_new_tokens": 128,
        "no_repeat_ngram_size": 3,
    }

    # Whisper/Breeze language prompt
    try:
        forced_decoder_ids = asr_processor.get_decoder_prompt_ids(
            language="zh",
            task="transcribe",
        )
        generate_kwargs["forced_decoder_ids"] = forced_decoder_ids
    except Exception:
        generate_kwargs["language"] = "zh"
        generate_kwargs["task"] = "transcribe"

    if hasattr(inputs, "attention_mask") and inputs.attention_mask is not None:
        generate_kwargs["attention_mask"] = inputs.attention_mask.to(asr_device)

    with torch.no_grad():
        predicted_ids = asr_model.generate(
            input_features,
            **generate_kwargs,
        )

    text = asr_processor.batch_decode(
        predicted_ids,
        skip_special_tokens=True,
    )[0]

    return text.strip()

async def transcribe_and_send(
    websocket: WebSocket,
    send_lock: asyncio.Lock,
    relay_lock: asyncio.Lock,
    filename: Path,
    segment_audio: np.ndarray,
    start_time: float,
    end_time: float,
    duration: float,
    reason: str,
    source: str,
    scope: str,
    agent_type: str,
    room_name: Optional[str],
    participant_id: Optional[str],
    user_id: Optional[str],
    display_name: Optional[str],
    retranscribed_final: bool = False,
    save_transcript: bool = True,
    relay_to_pipeline: bool = True,
    on_transcript=None,
):
    try:
        # print(f"Transcribing segment: {filename}")

        print(
            "ASR segment start: "
            f"roomName={room_name}, participantId={participant_id or user_id}, "
            f"reason={reason}, duration={duration:.2f}s, file={filename}"
        )
        async with send_lock:
            transcript = await asyncio.to_thread(
                transcribe_audio_float32,
                segment_audio,
            )
            # transcript = await asyncio.to_thread(
            #     transcribe_audio_file,
            #     filename,
            #     segment_audio,
            # )

        transcript = clean_asr_transcript_text(transcript)
        if not transcript:
            print(
                "ASR transcript skipped after marker cleanup: "
                f"roomName={room_name}, participantId={participant_id or user_id}, reason={reason}"
            )
            return

        # raw_transcript = transcript
        # traditional_transcript = to_traditional(raw_transcript)
        
        # print(f"Transcript: {traditional_transcript}")
        print(
            "ASR transcript generated: "
            f"roomName={room_name}, participantId={participant_id or user_id}, "
            f"reason={reason}, chars={len(transcript)}, text={transcript}"
        )
        if on_transcript is not None and transcript.strip():
            on_transcript(transcript)

        if save_transcript:
            save_transcript_jsonl(
                file=str(filename),
                start=start_time,
                end=end_time,
                duration=duration,
                text=transcript,
                # text=traditional_transcript,
                source=source,
                scope=scope,
                agent_type=agent_type,
                room_name=room_name,
                participant_id=participant_id,
                user_id=user_id,
                display_name=display_name,
                reason=reason,
            )

        try:
            # print("[ASR raw]", raw_transcript)
            # print("[ASR traditional]", traditional_transcript)

            async with send_lock:
                await websocket.send_json({
                    "type": "transcript",
                    "source": source,
                    "scope": scope,
                    "agentType": agent_type,
                    "roomName": room_name,
                    "participantId": participant_id,
                    "userId": user_id,
                    "displayName": display_name,
                    "file": str(filename),
                    "start": round(start_time, 2),
                    "end": round(end_time, 2),
                "duration": round(duration, 2),
                "reason": reason,
                "text": transcript,
                "persisted": False if not relay_to_pipeline else None,
                "retranscribedFinal": retranscribed_final,
                # "text": traditional_transcript,
            })
        except Exception:
            print("Cannot send transcript because websocket is closed")

        if relay_to_pipeline:
            async with relay_lock:
                await relay_transcript_to_pipeline(
                    websocket=websocket,
                    send_lock=send_lock,
                    text=transcript,
                    reason=reason,
                    source=source,
                    scope=scope,
                    agent_type=agent_type,
                    room_name=room_name,
                    participant_id=participant_id,
                    user_id=user_id,
                    display_name=display_name,
                    start=start_time,
                    end=end_time,
                    duration=duration,
                    retranscribed_final=retranscribed_final,
                )

    except Exception as e:
        print(f"ASR error for {filename}: {e}")

        try:
            async with send_lock:
                await websocket.send_json({
                    "type": "asr_error",
                    "file": str(filename),
                    "error": str(e),
                })
        except Exception:
            print("Cannot send ASR error because websocket is closed")


# =========================
# WebSocket endpoint
# =========================

def build_whisperlivekit_ws_url() -> str:
    query = {
        "language": "zh",
        "mode": WHISPERLIVEKIT_MODE or "full",
    }
    separator = "&" if "?" in WHISPERLIVEKIT_WS_URL else "?"
    return f"{WHISPERLIVEKIT_WS_URL}{separator}{urlencode(query)}"


def encode_pcm_s16le(audio: np.ndarray) -> bytes:
    audio = np.asarray(audio, dtype=np.float32)
    if len(audio) == 0:
        return b""
    audio = np.clip(audio, -1.0, 1.0)
    return (audio * 32767).astype("<i2").tobytes()


def parse_whisperlivekit_timestamp(value: Any) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    if not isinstance(value, str):
        return 0.0
    parts = value.strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 1 and parts[0]:
            return float(parts[0])
    except ValueError:
        return 0.0
    return 0.0


async def handle_whisperlivekit_audio_ws(
    websocket: WebSocket,
    *,
    session_id: Optional[str],
    participant_id: Optional[str],
) -> None:
    send_lock = asyncio.Lock()
    relay_lock = asyncio.Lock()
    wlk_url = build_whisperlivekit_ws_url()

    source = "unknown"
    scope = "unknown"
    agent_type = "unknown"
    room_name = session_id
    user_id = participant_id
    display_name = participant_id
    input_sample_rate = SAMPLE_RATE
    encoding = "float32"
    channels = 1

    latest_buffer_text = ""
    current_draft_text = ""
    current_segment_index = 1
    finalized_silence_keys: set[str] = set()
    last_finalized_state_line_count = 0
    state_lines: list[dict[str, Any]] = []
    pending_silence_task: asyncio.Task | None = None
    pending_silence_key: str | None = None
    session_started = False

    async def send_client_json(payload: dict[str, Any]) -> None:
        try:
            async with send_lock:
                await websocket.send_json(payload)
        except Exception:
            print("Cannot send WhisperLiveKit proxy payload because websocket is closed")

    def whisperlivekit_line_text(line: dict[str, Any]) -> str:
        return clean_asr_transcript_text(str(line.get("text") or line.get("transcription") or ""))

    def whisperlivekit_line_is_silence(line: dict[str, Any]) -> bool:
        return line.get("speaker") == -2

    def whisperlivekit_line_start(line: dict[str, Any]) -> float:
        return parse_whisperlivekit_timestamp(line.get("start", line.get("beg")))

    def whisperlivekit_line_end(line: dict[str, Any]) -> float:
        return parse_whisperlivekit_timestamp(line.get("end"))

    def whisperlivekit_line_key(line: dict[str, Any], line_index: int, text: str = "") -> str:
        start_time = whisperlivekit_line_start(line)
        end_time = whisperlivekit_line_end(line)
        return f"{line_index}|{start_time:.2f}|{end_time:.2f}|{text}"

    def latest_speech_line(lines: list[dict[str, Any]]) -> tuple[int, dict[str, Any]] | None:
        for line_index in range(len(lines), 0, -1):
            line = lines[line_index - 1]
            if isinstance(line, dict) and not whisperlivekit_line_is_silence(line) and whisperlivekit_line_text(line):
                return line_index, line
        return None

    def build_live_text(lines: list[dict[str, Any]], buffer_text: str) -> str:
        latest = latest_speech_line(lines)
        latest_line_text = whisperlivekit_line_text(latest[1]) if latest else ""

        normalized_buffer = buffer_text.strip()
        if latest_line_text and normalized_buffer:
            return merge_transcript_text(latest_line_text, normalized_buffer)
        return latest_line_text or normalized_buffer

    def active_state_lines() -> list[dict[str, Any]]:
        return state_lines[last_finalized_state_line_count:]

    def finalized_tail_silence_key() -> str | None:
        if not state_lines:
            return None
        tail_index = len(state_lines)
        if tail_index <= last_finalized_state_line_count:
            return None
        tail_line = state_lines[-1]
        if not isinstance(tail_line, dict) or not whisperlivekit_line_is_silence(tail_line):
            return None
        return whisperlivekit_line_key(tail_line, tail_index)

    async def forward_draft(text: str) -> None:
        nonlocal latest_buffer_text, current_draft_text
        normalized_text = clean_asr_transcript_text(text)
        if not normalized_text or normalized_text == latest_buffer_text:
            return
        latest_buffer_text = normalized_text
        current_draft_text = normalized_text
        await send_client_json({
            "type": "transcript",
            "source": source,
            "scope": scope,
            "agentType": agent_type,
            "roomName": room_name,
            "participantId": participant_id,
            "userId": user_id,
            "displayName": display_name,
            "segment_id": f"wlk-live-{participant_id or user_id or 'unknown'}-{current_segment_index}",
            "start": 0,
            "end": 0,
            "duration": 0,
            "reason": LIVE_TRANSCRIPT_REASON,
            "text": normalized_text,
            "persisted": False,
            "replaceDraft": True,
        })

    async def forward_final_text(text: str, line: dict[str, Any] | None = None) -> None:
        nonlocal current_draft_text, current_segment_index, latest_buffer_text, pending_silence_key
        text = clean_asr_transcript_text(text)
        if not text:
            return
        start_time = whisperlivekit_line_start(line) if line else 0.0
        end_time = whisperlivekit_line_end(line) if line else 0.0
        duration = max(0.0, end_time - start_time)
        latest_buffer_text = ""
        current_draft_text = ""
        pending_silence_key = None
        line_id = f"wlk-final-{participant_id or user_id or 'unknown'}-{current_segment_index}"
        current_segment_index += 1
        payload = {
            "type": "transcript",
            "source": source,
            "scope": scope,
            "agentType": agent_type,
            "roomName": room_name,
            "participantId": participant_id,
            "userId": user_id,
            "displayName": display_name,
            "segment_id": line_id,
            "start": round(start_time, 2),
            "end": round(end_time, 2),
            "duration": round(duration, 2),
            "reason": "silence",
            "text": text,
            "persisted": None,
            "retranscribedFinal": False,
        }
        await send_client_json(payload)
        save_transcript_jsonl(
            file=line_id,
            start=start_time,
            end=end_time,
            duration=duration,
            text=text,
            source=source,
            scope=scope,
            agent_type=agent_type,
            room_name=room_name,
            participant_id=participant_id,
            user_id=user_id,
            display_name=display_name,
            reason="silence",
        )
        async with relay_lock:
            await relay_transcript_to_pipeline(
                websocket=websocket,
                send_lock=send_lock,
                text=text,
                reason="silence",
                source=source,
                scope=scope,
                agent_type=agent_type,
                room_name=room_name,
                participant_id=participant_id,
                user_id=user_id,
                display_name=display_name,
                start=start_time,
                end=end_time,
                duration=duration,
                retranscribed_final=False,
            )

    async def finalize_current_draft_from_silence(silence_key: str) -> None:
        nonlocal last_finalized_state_line_count
        if not state_lines:
            return
        tail_index = len(state_lines)
        if tail_index <= last_finalized_state_line_count:
            return
        tail_line = state_lines[-1]
        if not isinstance(tail_line, dict) or not whisperlivekit_line_is_silence(tail_line):
            return

        if silence_key in finalized_silence_keys:
            return

        latest = latest_speech_line(state_lines[last_finalized_state_line_count:-1])
        source_line = latest[1] if latest else None
        if not current_draft_text:
            return

        finalized_silence_keys.add(silence_key)
        last_finalized_state_line_count = tail_index
        await forward_final_text(current_draft_text, source_line)

    def cancel_pending_silence_finalize() -> None:
        nonlocal pending_silence_task, pending_silence_key
        if pending_silence_task and not pending_silence_task.done():
            pending_silence_task.cancel()
        pending_silence_task = None
        pending_silence_key = None

    def schedule_silence_finalize(silence_key: str) -> None:
        nonlocal pending_silence_task, pending_silence_key
        if not current_draft_text or silence_key in finalized_silence_keys:
            return
        if pending_silence_key == silence_key and pending_silence_task and not pending_silence_task.done():
            return

        cancel_pending_silence_finalize()
        pending_silence_key = silence_key

        async def delayed_finalize() -> None:
            try:
                await asyncio.sleep(WHISPERLIVEKIT_FINAL_SILENCE_SEC)
                if pending_silence_key != silence_key:
                    return
                await finalize_current_draft_from_silence(silence_key)
            except asyncio.CancelledError:
                return

        pending_silence_task = asyncio.create_task(delayed_finalize())

    async def handle_wlk_message(raw_message: str) -> None:
        nonlocal state_lines, last_finalized_state_line_count
        try:
            message = json.loads(raw_message)
        except Exception:
            return
        if not isinstance(message, dict):
            return

        message_type = message.get("type")
        if message_type == "config":
            print("WhisperLiveKit config:", message)
            return
        if message_type == "ready_to_stop":
            cancel_pending_silence_finalize()
            if current_draft_text:
                latest = latest_speech_line(state_lines)
                await forward_final_text(current_draft_text, latest[1] if latest else None)
            print("WhisperLiveKit ready_to_stop")
            return
        if message.get("error"):
            await send_client_json({"type": "asr_error", "error": str(message.get("error"))})
            return

        if message_type == "snapshot":
            state_lines = list(message.get("lines") or [])
            last_finalized_state_line_count = min(last_finalized_state_line_count, len(state_lines))
        elif message_type == "diff":
            pruned = int(message.get("lines_pruned") or 0)
            if pruned > 0:
                state_lines = state_lines[pruned:]
                last_finalized_state_line_count = max(0, last_finalized_state_line_count - pruned)
            state_lines.extend(list(message.get("new_lines") or []))
        elif "lines" in message:
            state_lines = list(message.get("lines") or [])
            last_finalized_state_line_count = min(last_finalized_state_line_count, len(state_lines))

        buffer_text = str(message.get("buffer_transcription") or "")
        tail_silence_key = finalized_tail_silence_key()
        if tail_silence_key is None:
            cancel_pending_silence_finalize()
            await forward_draft(build_live_text(active_state_lines(), buffer_text))
        elif tail_silence_key not in finalized_silence_keys:
            await forward_draft(build_live_text(active_state_lines()[:-1], buffer_text))
            schedule_silence_finalize(tail_silence_key)

    try:
        wlk_ws = None
        for attempt in range(1, 11):
            try:
                wlk_ws = await websockets.connect(wlk_url, max_size=None)
                break
            except OSError as exc:
                if attempt >= 10:
                    raise
                wait_seconds = min(attempt, 5)
                print(
                    "WhisperLiveKit proxy connect failed "
                    f"(attempt {attempt}/10): {exc}; retrying in {wait_seconds}s"
                )
                await asyncio.sleep(wait_seconds)

        if wlk_ws is None:
            raise RuntimeError("WhisperLiveKit proxy connection was not created")

        try:
            print(f"Connected to WhisperLiveKit: {wlk_url}")

            async def receive_wlk_messages() -> None:
                async for raw_message in wlk_ws:
                    if isinstance(raw_message, str):
                        await handle_wlk_message(raw_message)

            receiver_task = asyncio.create_task(receive_wlk_messages())
            try:
                while True:
                    data = await websocket.receive()
                    if data.get("type") == "websocket.disconnect":
                        await wlk_ws.send(b"")
                        break

                    raw_text = data.get("text")
                    if raw_text is not None:
                        try:
                            msg = json.loads(raw_text)
                        except Exception:
                            continue
                        if not isinstance(msg, dict):
                            continue

                        msg_type = msg.get("type")
                        if msg_type == "start":
                            source = msg.get("source", source)
                            scope = msg.get("scope", scope)
                            agent_type = msg.get("agentType", agent_type)
                            room_name = msg.get("roomName", room_name)
                            user_id = msg.get("userId", user_id)
                            display_name = msg.get("displayName", display_name)
                            input_sample_rate = int(msg.get("sampleRate", input_sample_rate))
                            encoding = msg.get("encoding", msg.get("format", encoding))
                            channels = int(msg.get("channels", channels))
                            session_started = True
                            await send_client_json({
                                "type": "joined",
                                "session_name": room_name,
                                "participant_id": participant_id,
                                "engine": "whisperlivekit",
                            })
                            continue
                        if msg_type == "stop":
                            await wlk_ws.send(b"")
                            break
                        if msg_type == "reset_outputs":
                            result = clear_output_files()
                            await send_client_json({"type": "reset_outputs_done", **result})
                            continue
                        continue

                    pcm_bytes = data.get("bytes")
                    if pcm_bytes is None or not session_started:
                        continue

                    try:
                        decoded_audio = decode_audio_bytes(
                            pcm_bytes,
                            encoding=encoding,
                            input_sample_rate=input_sample_rate,
                        )
                    except Exception as exc:
                        print(f"WhisperLiveKit proxy decode error: {exc}")
                        continue
                    if channels != 1:
                        print(f"Warning: channels={channels}. WhisperLiveKit proxy expects mono PCM.")
                    encoded_audio = encode_pcm_s16le(decoded_audio)
                    if encoded_audio:
                        await wlk_ws.send(encoded_audio)
            finally:
                try:
                    await asyncio.wait_for(receiver_task, timeout=15)
                except Exception:
                    receiver_task.cancel()
                    await asyncio.gather(receiver_task, return_exceptions=True)
        finally:
            cancel_pending_silence_finalize()
            await wlk_ws.close()
    except Exception as exc:
        print(f"WhisperLiveKit proxy error: {exc}")
        await send_client_json({"type": "asr_error", "error": str(exc), "engine": "whisperlivekit"})

@app.websocket("/ws/audio")
@app.websocket("/sessions/{session_id}/audio-stream")
async def audio_ws(
    websocket: WebSocket,
    session_id: Optional[str] = None,
    participant_id: Optional[str] = Query(None),
):
    await websocket.accept()

    if ASR_ENGINE != "local":
        await handle_whisperlivekit_audio_ws(
            websocket,
            session_id=session_id,
            participant_id=participant_id,
        )
        return

    url_participant_id = participant_id

    if session_id is not None:
        print(
            "WebSocket connected: "
            f"session_id={session_id}, participant_id={url_participant_id}"
        )
    else:
        print("WebSocket connected")

    send_lock = asyncio.Lock()
    relay_lock = asyncio.Lock()
    asr_tasks = set()
    live_asr_tasks = set()

    # Metadata from URL first, then start message can override it
    source = "unknown"
    scope = "unknown"
    agent_type = "unknown"
    room_name = session_id
    participant_id = url_participant_id
    user_id = url_participant_id
    display_name = url_participant_id
    client_id = None

    input_sample_rate = SAMPLE_RATE
    encoding = "float32"
    channels = 1

    # Per-connection audio state
    pending_audio = np.zeros(0, dtype=np.float32)
    max_speech_batch_audio_segments = []
    max_speech_batch_start_time = None

    chunk_count = 0
    segment_count = 0

    speech_started = False
    speech_chunks = 0
    silence_chunks = 0
    speech_start_time = None
    next_live_speech_chunk = 0
    live_window_count = 0
    merged_live_transcript = ""

    pre_buffer = deque(maxlen=PRE_BUFFER_CHUNKS)
    segment_buffer = []

    connection_start_time = time.monotonic()
    has_received_start = False

    async def finalize_segment(end_reason: str):
        nonlocal speech_started
        nonlocal speech_chunks
        nonlocal silence_chunks
        nonlocal speech_start_time
        nonlocal segment_buffer
        nonlocal segment_count
        nonlocal max_speech_batch_audio_segments
        nonlocal max_speech_batch_start_time
        nonlocal next_live_speech_chunk
        nonlocal live_window_count
        nonlocal merged_live_transcript

        if not speech_started or not segment_buffer:
            speech_started = False
            speech_chunks = 0
            silence_chunks = 0
            speech_start_time = None
            next_live_speech_chunk = 0
            live_window_count = 0
            merged_live_transcript = ""
            segment_buffer = []
            return

        segment_audio = np.concatenate(segment_buffer).astype(np.float32)
        duration = len(segment_audio) / SAMPLE_RATE

        start_time = float(speech_start_time if speech_start_time is not None else 0.0)
        end_time = start_time + duration

        print(
            f"VAD event: end={end_time:.2f}, "
            f"duration={duration:.2f}, reason={end_reason}"
        )

        try:
            async with send_lock:
                await websocket.send_json({
                    "type": "vad",
                    "event": {
                        "end": round(end_time, 2),
                        "source": "backend_silero",
                        "reason": end_reason,
                    }
                })
        except Exception:
            print("Cannot send VAD end because websocket is closed")

        if live_asr_tasks:
            print(f"Waiting for {len(live_asr_tasks)} live ASR task(s) before finalizing segment...")
            await asyncio.gather(*list(live_asr_tasks), return_exceptions=True)

        final_transcript = merged_live_transcript.strip()

        if duration >= MIN_SAVE_DURATION_SEC and final_transcript:
            segment_count += 1
            asr_start_time = start_time
            asr_end_time = end_time
            asr_duration = duration

            if end_reason == "max_speech_ms":
                if max_speech_batch_start_time is None:
                    max_speech_batch_start_time = start_time
                max_speech_batch_audio_segments.append(final_transcript)
            elif end_reason in PIPELINE_FINAL_REASONS and max_speech_batch_audio_segments:
                combined_segments = [*max_speech_batch_audio_segments, final_transcript]
                combined_text = ""
                for segment_text in combined_segments:
                    combined_text = merge_transcript_text(combined_text, segment_text)
                if combined_text:
                    final_transcript = combined_text
                    asr_start_time = float(max_speech_batch_start_time if max_speech_batch_start_time is not None else start_time)
                    asr_end_time = end_time
                    asr_duration = max(0.0, asr_end_time - asr_start_time)
                    print(
                        "Merged max_speech transcript batch without final ASR: "
                        f"duration={asr_duration:.2f}s, segments={len(combined_segments)}"
                    )
                max_speech_batch_audio_segments = []
                max_speech_batch_start_time = None

            safe_scope = sanitize_filename_part(scope)
            safe_room = sanitize_filename_part(room_name)
            safe_participant = sanitize_filename_part(participant_id or user_id or display_name)
            safe_reason = sanitize_filename_part(end_reason)

            filename = SEGMENT_DIR / (
                # f"{safe_scope}_{safe_room}_{safe_participant}_"
                f"speech_{segment_count:03d}_"
                f"{round(start_time, 2)}_"
                f"{round(end_time, 2)}_"
                f"{safe_reason}.wav"
            )

            save_wav_float32(filename, segment_audio, SAMPLE_RATE)

            # print(
            #     f"Saved segment: {filename} "
            #     f"duration={duration:.2f}s "
            #     f"reason={end_reason}"
            # )

            try:
                async with send_lock:
                    await websocket.send_json({
                        "type": "segment_saved",
                        "source": source,
                        "scope": scope,
                        "agentType": agent_type,
                        "roomName": room_name,
                        "participantId": participant_id,
                        "userId": user_id,
                        "displayName": display_name,
                        "file": str(filename),
                        "duration": round(duration, 2),
                        "start": round(start_time, 2),
                        "end": round(end_time, 2),
                        "reason": end_reason,
                    })
            except Exception:
                print("Cannot send segment_saved because websocket is closed")

            save_transcript_jsonl(
                file=str(filename),
                start=asr_start_time,
                end=asr_end_time,
                duration=asr_duration,
                text=final_transcript,
                source=source,
                scope=scope,
                agent_type=agent_type,
                room_name=room_name,
                participant_id=participant_id,
                user_id=user_id,
                display_name=display_name,
                reason=end_reason,
            )

            try:
                async with send_lock:
                    await websocket.send_json({
                        "type": "transcript",
                        "source": source,
                        "scope": scope,
                        "agentType": agent_type,
                        "roomName": room_name,
                        "participantId": participant_id,
                        "userId": user_id,
                        "displayName": display_name,
                        "file": str(filename),
                        "start": round(asr_start_time, 2),
                        "end": round(asr_end_time, 2),
                        "duration": round(asr_duration, 2),
                        "reason": end_reason,
                        "text": final_transcript,
                        "persisted": None,
                        "retranscribedFinal": False,
                    })
            except Exception:
                print("Cannot send final transcript because websocket is closed")

            async with relay_lock:
                await relay_transcript_to_pipeline(
                    websocket=websocket,
                    send_lock=send_lock,
                    text=final_transcript,
                    reason=end_reason,
                    source=source,
                    scope=scope,
                    agent_type=agent_type,
                    room_name=room_name,
                    participant_id=participant_id,
                    user_id=user_id,
                    display_name=display_name,
                    start=asr_start_time,
                    end=asr_end_time,
                    duration=asr_duration,
                    retranscribed_final=False,
                )

        else:
            print(
                "Skipped final segment: "
                f"duration={duration:.2f}s, has_live_transcript={bool(final_transcript)}"
            )

        speech_started = False
        speech_chunks = 0
        silence_chunks = 0
        speech_start_time = None
        next_live_speech_chunk = 0
        live_window_count = 0
        merged_live_transcript = ""
        segment_buffer = []

    def schedule_live_transcript(current_time: float) -> bool:
        nonlocal live_window_count, merged_live_transcript

        def remember_live_transcript(transcript: str) -> None:
            nonlocal merged_live_transcript
            merged_live_transcript = merge_transcript_text(merged_live_transcript, transcript)

        if live_asr_tasks or not segment_buffer:
            return False

        segment_audio = np.concatenate(segment_buffer).astype(np.float32)
        if len(segment_audio) < STREAM_MIN_LIVE_CHUNKS * CHUNK_SIZE:
            return False

        live_window_count += 1
        window_audio = segment_audio[-STREAM_WINDOW_SAMPLES:].copy() if len(segment_audio) > STREAM_WINDOW_SAMPLES else segment_audio.copy()
        duration = len(window_audio) / SAMPLE_RATE
        end_time = current_time
        start_time = max(0.0, end_time - duration)

        safe_reason = sanitize_filename_part(LIVE_TRANSCRIPT_REASON)
        filename = SEGMENT_DIR / (
            f"live_{live_window_count:03d}_"
            f"{round(start_time, 2)}_"
            f"{round(end_time, 2)}_"
            f"{safe_reason}.wav"
        )

        print(
            "Live ASR window scheduled: "
            f"roomName={room_name}, participantId={participant_id or user_id}, "
            f"start={start_time:.2f}, end={end_time:.2f}, duration={duration:.2f}s"
        )

        task = asyncio.create_task(
            transcribe_and_send(
                websocket=websocket,
                send_lock=send_lock,
                relay_lock=relay_lock,
                filename=filename,
                segment_audio=window_audio,
                start_time=start_time,
                end_time=end_time,
                duration=duration,
                reason=LIVE_TRANSCRIPT_REASON,
                source=source,
                scope=scope,
                agent_type=agent_type,
                room_name=room_name,
                participant_id=participant_id,
                user_id=user_id,
                display_name=display_name,
                save_transcript=False,
                relay_to_pipeline=False,
                on_transcript=remember_live_transcript,
            )
        )
        asr_tasks.add(task)
        live_asr_tasks.add(task)
        task.add_done_callback(asr_tasks.discard)
        task.add_done_callback(live_asr_tasks.discard)
        return True

    try:
        while True:
            data = await websocket.receive()

            if data.get("type") == "websocket.disconnect":
                print("WebSocket disconnected")
                await finalize_segment("disconnect")
                break

            # =========================
            # JSON control messages
            # =========================

            if "text" in data:
                try:
                    msg = json.loads(data["text"])
                except Exception:
                    print("Text message:", data["text"])
                    continue

                msg_type = msg.get("type")

                if msg_type == "reset_outputs":
                    result = clear_output_files()

                    await websocket.send_json({
                        "type": "reset_outputs_done",
                        **result,
                    })

                    continue

                if msg_type == "start":
                    next_source = msg.get("source", source)
                    next_scope = msg.get("scope", scope)
                    next_agent_type = msg.get("agentType", agent_type)
                    next_room_name = msg.get("roomName", room_name)
                    next_participant_id = msg.get("participantId", participant_id)
                    next_user_id = msg.get("userId", user_id)
                    next_display_name = msg.get("displayName", display_name)
                    next_client_id = msg.get("clientId", client_id)
                    next_input_sample_rate = int(msg.get("sampleRate", input_sample_rate))
                    next_encoding = msg.get("encoding", msg.get("format", encoding))
                    next_channels = int(msg.get("channels", channels))

                    current_stream_key = (
                        source,
                        scope,
                        agent_type,
                        room_name,
                        participant_id,
                        user_id,
                        display_name,
                        input_sample_rate,
                        encoding,
                        channels,
                    )
                    next_stream_key = (
                        next_source,
                        next_scope,
                        next_agent_type,
                        next_room_name,
                        next_participant_id,
                        next_user_id,
                        next_display_name,
                        next_input_sample_rate,
                        next_encoding,
                        next_channels,
                    )

                    stream_changed = has_received_start and next_stream_key != current_stream_key

                    if stream_changed:
                        print(
                            "Control start indicates stream/mic-mode switch: "
                            f"from scope={scope}, agentType={agent_type}, source={source} "
                            f"to scope={next_scope}, agentType={next_agent_type}, source={next_source}"
                        )

                        # 先用舊 metadata 結束目前 segment
                        await finalize_segment("mic_mode_switch")

                        # 避免舊模式殘留音訊混進新模式
                        pending_audio = np.zeros(0, dtype=np.float32)
                        pre_buffer.clear()

                    source = next_source
                    scope = next_scope
                    agent_type = next_agent_type
                    room_name = next_room_name
                    participant_id = next_participant_id
                    user_id = next_user_id
                    display_name = next_display_name
                    client_id = next_client_id
                    input_sample_rate = next_input_sample_rate
                    encoding = next_encoding
                    channels = next_channels
                    has_received_start = True

                    print(
                        "Control start: "
                        f"source={source}, "
                        f"scope={scope}, "
                        f"agentType={agent_type}, "
                        f"roomName={room_name}, "
                        f"participantId={participant_id}, "
                        f"userId={user_id}, "
                        f"displayName={display_name}, "
                        f"clientId={client_id}, "
                        f"sampleRate={input_sample_rate}, "
                        f"encoding={encoding}, "
                        f"channels={channels}"
                    )

                    if channels != 1:
                        print(
                            f"Warning: channels={channels}. "
                            "This gateway currently expects mono PCM."
                        )

                    continue

                if msg_type == "stop":
                    print("Control stop received")
                    await finalize_segment("client_stop")

                    if asr_tasks:
                        print(f"Waiting for {len(asr_tasks)} ASR task(s) before closing websocket...")
                        await asyncio.gather(*list(asr_tasks), return_exceptions=True)

                    print("All ASR tasks completed. Closing websocket.")
                    break

                # Ignore frontend-VAD protocol messages in gateway mode.
                if msg_type in ("speech_start", "speech_end"):
                    print(
                        f"Warning: received {msg_type}, but server_gateway.py "
                        "expects continuous PCM. Ignored."
                    )
                    continue

                print("Unknown control message:", msg)
                continue

            # =========================
            # Binary audio chunks
            # =========================

            if "bytes" not in data:
                continue

            pcm_bytes = data["bytes"]

            try:
                decoded_audio = decode_audio_bytes(
                    pcm_bytes,
                    encoding=encoding,
                    input_sample_rate=input_sample_rate,
                )
            except Exception as e:
                print(f"Decode error: {e}")
                continue

            if len(decoded_audio) == 0:
                continue

            # Accumulate arbitrary input chunk sizes and process exactly 512 samples per VAD step.
            merged = np.concatenate([pending_audio, decoded_audio]).astype(np.float32)

            offset = 0

            while offset + CHUNK_SIZE <= len(merged):
                audio_chunk = merged[offset:offset + CHUNK_SIZE].astype(np.float32, copy=True)
                offset += CHUNK_SIZE

                chunk_count += 1
                current_time = chunk_count * CHUNK_SIZE / SAMPLE_RATE

                # Keep pre-buffer before speech start
                pre_buffer.append(audio_chunk.copy())

                rms, peak = get_audio_stats(audio_chunk)

                audio_tensor = torch.from_numpy(audio_chunk.copy())

                with torch.no_grad():
                    speech_prob = float(vad_model(audio_tensor, SAMPLE_RATE).item())

                # Force silence for almost-zero chunks
                if rms < RMS_SILENCE_THRESHOLD:
                    effective_prob = 0.0
                else:
                    effective_prob = speech_prob

                if chunk_count % 50 == 0:
                    print(
                        f"chunk={chunk_count}, "
                        f"rms={rms:.6f}, "
                        # f"peak={peak:.6f}, "
                        # f"prob={speech_prob:.4f}, "
                        # f"effective_prob={effective_prob:.4f}, "
                        # f"speech_started={speech_started}, "
                        f"silence_chunks={silence_chunks}"
                    )

                if not speech_started:
                    if effective_prob >= START_THRESHOLD:
                        speech_started = True
                        speech_chunks = 0
                        silence_chunks = 0
                        next_live_speech_chunk = 0
                        merged_live_transcript = ""
                        speech_start_time = current_time

                        # Include pre-buffer to avoid cutting the first syllable
                        segment_buffer = list(pre_buffer)

                        print(f"VAD event: start={current_time:.2f}")

                        try:
                            async with send_lock:
                                await websocket.send_json({
                                    "type": "vad",
                                    "event": {
                                        "start": round(current_time, 2),
                                        "source": "backend_silero",
                                    }
                                })
                        except Exception:
                            print("Cannot send VAD start because websocket is closed")

                    continue

                # Already in speech
                speech_chunks += 1
                segment_buffer.append(audio_chunk.copy())

                if speech_chunks >= next_live_speech_chunk and len(segment_buffer) * CHUNK_SIZE >= STREAM_MIN_LIVE_CHUNKS * CHUNK_SIZE:
                    if schedule_live_transcript(current_time):
                        next_live_speech_chunk = speech_chunks + STREAM_STEP_CHUNKS

                if effective_prob < END_THRESHOLD:
                    silence_chunks += 1
                else:
                    silence_chunks = 0

                if speech_chunks < MIN_SPEECH_CHUNKS:
                    continue

                is_silence_end = silence_chunks >= MIN_SILENCE_CHUNKS
                is_max_length_end = speech_chunks >= MAX_SPEECH_CHUNKS

                if is_silence_end or is_max_length_end:
                    end_reason = "max_speech_ms" if is_max_length_end else "silence"
                    await finalize_segment(end_reason)

            pending_audio = merged[offset:].astype(np.float32, copy=True)

    except WebSocketDisconnect:
        print("WebSocket disconnected")
        await finalize_segment("disconnect")

    except Exception as e:
        print("Backend error:", e)
        await finalize_segment("error")
