import asyncio
import json
import math
import os
import time
import wave
from collections import deque
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse
# from transformers import WhisperProcessor, WhisperForConditionalGeneration
from funasr import AutoModel
from transcript_normalizer import to_traditional

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
MAX_SPEECH_MS = 20000

MIN_SILENCE_CHUNKS = int((MIN_SILENCE_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)
MIN_SPEECH_CHUNKS = int((MIN_SPEECH_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)
MAX_SPEECH_CHUNKS = int((MAX_SPEECH_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)

PRE_BUFFER_MS = 500
PRE_BUFFER_CHUNKS = int((PRE_BUFFER_MS / 1000) * SAMPLE_RATE / CHUNK_SIZE)

RMS_SILENCE_THRESHOLD = 0.00005
MIN_SAVE_DURATION_SEC = 0.8

SEGMENT_DIR = BASE_DIR / "segments"
SEGMENT_DIR.mkdir(exist_ok=True)

TRANSCRIPT_FILE = BASE_DIR / "transcripts.jsonl"

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

print("Loading Silero VAD model...")

vad_model, vad_utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    force_reload=False,
    trust_repo=True,
)

vad_model.eval()

print("Silero VAD loaded")

# =========================
# Load Breeze ASR
# =========================

# ASR_MODEL_NAME = "MediaTek-Research/Breeze-ASR-25"

# asr_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# if asr_device.type == "cuda":
#     asr_dtype = torch.float16
#     print("CUDA detected. Breeze ASR will run on GPU.")
# else:
#     asr_dtype = torch.float32
#     print("CUDA not detected. Breeze ASR will run on CPU. This may be slow.")

# print("Loading Breeze ASR 25 from Hugging Face cache...")

# asr_processor = WhisperProcessor.from_pretrained(ASR_MODEL_NAME)

# asr_model = WhisperForConditionalGeneration.from_pretrained(
#     ASR_MODEL_NAME,
#     torch_dtype=asr_dtype,
# ).to(asr_device)

# asr_model.eval()

# print(f"Breeze ASR 25 loaded on {asr_device}")

def resolve_asr_device() -> str:
    configured_device = os.getenv("ASR_DEVICE", "auto").strip().lower()

    if configured_device in ("", "auto"):
        return "cuda:0" if torch.cuda.is_available() else "cpu"

    if configured_device == "cuda":
        return "cuda:0"

    return configured_device


def log_torch_runtime():
    print(
        "Torch runtime: "
        f"version={torch.__version__}, "
        f"cuda_build={torch.version.cuda}, "
        f"cuda_available={torch.cuda.is_available()}"
    )

    if not torch.cuda.is_available():
        return

    try:
        capability = torch.cuda.get_device_capability(0)
        print(
            "CUDA device: "
            f"name={torch.cuda.get_device_name(0)}, "
            f"capability=sm_{capability[0]}{capability[1]}, "
            f"supported_arches={torch.cuda.get_arch_list()}"
        )
    except Exception as e:
        print(f"Failed to inspect CUDA device: {e}")


# =========================
# Load FunASR
# =========================

log_torch_runtime()

asr_device = resolve_asr_device()
punc_model = None if os.getenv("FUNASR_DISABLE_PUNC") == "1" else "ct-punc"

print(f"Loading FunASR on {asr_device}...")

asr_model = AutoModel(
    model="paraformer-zh",
    punc_model=punc_model,
    device=asr_device,
    disable_update=True,
    hub="hf",
)

print(f"FunASR loaded on {asr_device}")

# Avoid multiple ASR tasks using FunASR at the same time.
ASR_GLOBAL_LOCK = asyncio.Lock()

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


# def transcribe_audio_float32(audio_float32: np.ndarray) -> str:
#     """
#     Transcribe 16kHz mono float32 audio using Breeze ASR 25.
#     """
#     audio_float32 = np.asarray(audio_float32, dtype=np.float32)

#     if len(audio_float32) == 0:
#         return ""

#     audio_float32 = np.clip(audio_float32, -1.0, 1.0)

#     segment_rms = float(np.sqrt(np.mean(audio_float32 ** 2)))
#     segment_peak = float(np.max(np.abs(audio_float32)))

#     # print(f"ASR input stats: rms={segment_rms:.6f}, peak={segment_peak:.6f}")

#     # Avoid Whisper-like hallucination on almost-silent segments.
#     if segment_rms < 0.0008:
#         print("Skip ASR: segment rms too low")
#         return ""

#     inputs = asr_processor(
#         audio_float32,
#         sampling_rate=SAMPLE_RATE,
#         return_tensors="pt",
#         return_attention_mask=True,
#     )

#     input_features = inputs.input_features.to(asr_device)

#     if asr_device.type == "cuda":
#         input_features = input_features.to(torch.float16)

#     generate_kwargs = {
#         "max_new_tokens": 128,
#         "no_repeat_ngram_size": 3,
#     }

#     # Whisper/Breeze language prompt
#     try:
#         forced_decoder_ids = asr_processor.get_decoder_prompt_ids(
#             language="zh",
#             task="transcribe",
#         )
#         generate_kwargs["forced_decoder_ids"] = forced_decoder_ids
#     except Exception:
#         generate_kwargs["language"] = "zh"
#         generate_kwargs["task"] = "transcribe"

#     if hasattr(inputs, "attention_mask") and inputs.attention_mask is not None:
#         generate_kwargs["attention_mask"] = inputs.attention_mask.to(asr_device)

#     with torch.no_grad():
#         predicted_ids = asr_model.generate(
#             input_features,
#             **generate_kwargs,
#         )

#     text = asr_processor.batch_decode(
#         predicted_ids,
#         skip_special_tokens=True,
#     )[0]

#     return text.strip()

def extract_funasr_text(result) -> str:
    """
    Extract text from FunASR generate() result.
    Common output:
      [{'key': '...', 'text': '...'}]
    """
    if not result:
        return ""

    if isinstance(result, list):
        if len(result) == 0:
            return ""
        item = result[0]
    else:
        item = result

    if isinstance(item, dict):
        return str(item.get("text", "")).strip()

    return str(item).strip()


def transcribe_audio_file(filename: Path, audio_float32: np.ndarray) -> str:
    """
    Transcribe saved wav segment using FunASR.
    The segment has already been saved as 16kHz mono wav.
    """
    audio_float32 = np.asarray(audio_float32, dtype=np.float32)

    if len(audio_float32) == 0:
        return ""

    audio_float32 = np.clip(audio_float32, -1.0, 1.0)

    segment_rms = float(np.sqrt(np.mean(audio_float32 ** 2)))

    if segment_rms < 0.0008:
        print("Skip ASR: segment rms too low")
        return ""

    result = asr_model.generate(
        input=str(filename),
        language="zh",
        use_itn=True,
        batch_size_s=20,
    )

    return extract_funasr_text(result)

async def transcribe_and_send(
    websocket: WebSocket,
    send_lock: asyncio.Lock,
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
):
    try:
        # print(f"Transcribing segment: {filename}")

        
        async with ASR_GLOBAL_LOCK:
            # transcript = await asyncio.to_thread(
            #     transcribe_audio_float32,
            #     segment_audio,
            # )
            transcript = await asyncio.to_thread(
                transcribe_audio_file,
                filename,
                segment_audio,
            )

        raw_transcript = transcript
        traditional_transcript = to_traditional(raw_transcript)
        
        print(f"Transcript: {traditional_transcript}")

        save_transcript_jsonl(
            file=str(filename),
            start=start_time,
            end=end_time,
            duration=duration,
            text=traditional_transcript,
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
            print("[ASR raw]", raw_transcript)
            print("[ASR traditional]", traditional_transcript)

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
                    "text": traditional_transcript,
                })
        except Exception:
            print("Cannot send transcript because websocket is closed")

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

@app.websocket("/ws/audio")
@app.websocket("/sessions/{session_id}/audio-stream")
async def audio_ws(
    websocket: WebSocket,
    session_id: Optional[str] = None,
    participant_id: Optional[str] = Query(None),
):
    await websocket.accept()

    url_participant_id = participant_id

    if session_id is not None:
        print(
            "WebSocket connected: "
            f"session_id={session_id}, participant_id={url_participant_id}"
        )
    else:
        print("WebSocket connected")

    send_lock = asyncio.Lock()
    asr_tasks = set()

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

    chunk_count = 0
    segment_count = 0

    speech_started = False
    speech_chunks = 0
    silence_chunks = 0
    speech_start_time = None

    pre_buffer = deque(maxlen=PRE_BUFFER_CHUNKS)
    segment_buffer = []

    connection_start_time = time.monotonic()

    async def finalize_segment(end_reason: str):
        nonlocal speech_started
        nonlocal speech_chunks
        nonlocal silence_chunks
        nonlocal speech_start_time
        nonlocal segment_buffer
        nonlocal segment_count

        if not speech_started or not segment_buffer:
            speech_started = False
            speech_chunks = 0
            silence_chunks = 0
            speech_start_time = None
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

        if duration >= MIN_SAVE_DURATION_SEC:
            segment_count += 1

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

            task = asyncio.create_task(
                transcribe_and_send(
                    websocket=websocket,
                    send_lock=send_lock,
                    filename=filename,
                    segment_audio=segment_audio.copy(),
                    start_time=start_time,
                    end_time=end_time,
                    duration=duration,
                    reason=end_reason,
                    source=source,
                    scope=scope,
                    agent_type=agent_type,
                    room_name=room_name,
                    participant_id=participant_id,
                    user_id=user_id,
                    display_name=display_name,
                )
            )

            asr_tasks.add(task)
            task.add_done_callback(asr_tasks.discard)

        else:
            print(f"Skipped short segment: duration={duration:.2f}s")

        speech_started = False
        speech_chunks = 0
        silence_chunks = 0
        speech_start_time = None
        segment_buffer = []

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
                    source = msg.get("source", source)
                    scope = msg.get("scope", scope)
                    agent_type = msg.get("agentType", agent_type)
                    room_name = msg.get("roomName", room_name)
                    participant_id = msg.get("participantId", participant_id)
                    user_id = msg.get("userId", user_id)
                    display_name = msg.get("displayName", display_name)
                    client_id = msg.get("clientId", client_id)
                    input_sample_rate = int(msg.get("sampleRate", input_sample_rate))
                    encoding = msg.get("encoding", msg.get("format", encoding))
                    channels = int(msg.get("channels", channels))

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
