import argparse
import asyncio
import json
import time
import wave
from pathlib import Path

import numpy as np
import websockets


TARGET_SAMPLE_RATE = 16000
DEFAULT_WS_URL = "ws://localhost:8000/ws/audio"


def read_wav_as_float32_mono(path: Path) -> tuple[np.ndarray, int]:
    """
    Read a PCM wav file and return mono float32 audio in range [-1, 1].
    Supports common PCM sample widths: 8-bit, 16-bit, 24-bit, 32-bit.
    """
    with wave.open(str(path), "rb") as wf:
        channels = wf.getnchannels()
        sample_rate = wf.getframerate()
        sample_width = wf.getsampwidth()
        frames = wf.getnframes()

        raw = wf.readframes(frames)

    if sample_width == 1:
        # 8-bit PCM is unsigned
        audio = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
        audio = (audio - 128.0) / 128.0

    elif sample_width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        audio = audio / 32768.0

    elif sample_width == 3:
        # 24-bit PCM little-endian
        bytes_array = np.frombuffer(raw, dtype=np.uint8)

        if len(bytes_array) % 3 != 0:
            raise ValueError("Invalid 24-bit PCM data length")

        bytes_array = bytes_array.reshape(-1, 3)

        audio_int = (
            bytes_array[:, 0].astype(np.int32)
            | (bytes_array[:, 1].astype(np.int32) << 8)
            | (bytes_array[:, 2].astype(np.int32) << 16)
        )

        # Sign extension for 24-bit signed integer
        sign_bit = 1 << 23
        audio_int = (audio_int ^ sign_bit) - sign_bit

        audio = audio_int.astype(np.float32) / float(1 << 23)

    elif sample_width == 4:
        # Assume signed 32-bit PCM
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32)
        audio = audio / float(1 << 31)

    else:
        raise ValueError(f"Unsupported sample width: {sample_width} bytes")

    if channels > 1:
        audio = audio.reshape(-1, channels)
        audio = audio.mean(axis=1)

    audio = np.clip(audio, -1.0, 1.0).astype(np.float32)

    return audio, sample_rate


def resample_linear(
    audio: np.ndarray,
    input_sample_rate: int,
    output_sample_rate: int
) -> np.ndarray:
    """
    Simple linear resampler for local testing.
    For production, use scipy.signal.resample_poly or torchaudio.
    """
    if input_sample_rate == output_sample_rate:
        return audio.astype(np.float32, copy=False)

    if len(audio) == 0:
        return np.zeros(0, dtype=np.float32)

    duration = len(audio) / float(input_sample_rate)
    output_len = int(round(duration * output_sample_rate))

    old_x = np.linspace(0.0, duration, num=len(audio), endpoint=False)
    new_x = np.linspace(0.0, duration, num=output_len, endpoint=False)

    return np.interp(new_x, old_x, audio).astype(np.float32)


def float32_to_pcm_s16le(audio: np.ndarray) -> bytes:
    audio = np.asarray(audio, dtype=np.float32)
    audio = np.clip(audio, -1.0, 1.0)

    audio_int16 = (audio * 32767.0).astype(np.int16)

    return audio_int16.tobytes()


async def receive_messages(ws):
    """
    Print messages returned by server_gateway.py.
    """
    saw_transcript = False
    saw_asr_error = False

    try:
        async for message in ws:
            print("SERVER:", message)

            if not isinstance(message, str):
                continue

            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue

            message_type = payload.get("type")
            if message_type in ("transcript", "transcript.final"):
                saw_transcript = True
                print("SMOKE_RESULT: transcript")
            elif message_type in ("asr_error", "transcript_error"):
                saw_asr_error = True
                print(f"SMOKE_RESULT: {message_type}")

    except websockets.exceptions.ConnectionClosed:
        pass
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print("Receiver error:", e)

    return {
        "saw_transcript": saw_transcript,
        "saw_asr_error": saw_asr_error,
    }


async def send_audio_array(
    ws,
    audio: np.ndarray,
    chunk_samples: int,
    chunk_ms: int,
    realtime: bool,
    label: str,
):
    """
    Send float32 mono 16kHz audio array as pcm_s16le chunks.
    """
    sent_chunks = 0
    start_time = time.perf_counter()

    for offset in range(0, len(audio), chunk_samples):
        chunk = audio[offset:offset + chunk_samples]

        if len(chunk) == 0:
            continue

        pcm_bytes = float32_to_pcm_s16le(chunk)
        await ws.send(pcm_bytes)

        sent_chunks += 1

        if sent_chunks % 50 == 0:
            elapsed_audio = min(offset + len(chunk), len(audio)) / TARGET_SAMPLE_RATE
            elapsed_wall = time.perf_counter() - start_time

            # print(
            #     f"{label}: sent_chunks={sent_chunks}, "
            #     f"audio_time={elapsed_audio:.2f}s, "
            #     f"wall_time={elapsed_wall:.2f}s"
            # )

        if realtime:
            await asyncio.sleep(chunk_ms / 1000.0)


async def stream_wav_to_gateway(
    wav_path: Path,
    ws_url: str,
    room_name: str,
    participant_id: str,
    display_name: str,
    chunk_ms: int,
    realtime: bool,
    tail_silence_ms: int,
    wait_after_stop_sec: int,
    reset_outputs: bool,
):
    audio, input_sr = read_wav_as_float32_mono(wav_path)

    print(f"Loaded wav: {wav_path}")
    # print(f"Input sample rate: {input_sr}")
    print(f"Input duration: {len(audio) / input_sr:.2f}s")

    audio_16k = resample_linear(audio, input_sr, TARGET_SAMPLE_RATE)

    # print(f"Resampled duration: {len(audio_16k) / TARGET_SAMPLE_RATE:.2f}s")

    chunk_samples = int(TARGET_SAMPLE_RATE * chunk_ms / 1000)

    if chunk_samples <= 0:
        raise ValueError("chunk_ms too small")

    print(f"Connecting to {ws_url}")
    print(f"Chunk size: {chunk_samples} samples = {chunk_ms}ms")
    print(f"Tail silence: {tail_silence_ms}ms")
    print(f"Wait after stop: {wait_after_stop_sec}s")

    async with websockets.connect(ws_url, max_size=None) as ws:
        if reset_outputs:
            await ws.send(json.dumps({
                "type": "reset_outputs"
            }))

            reset_response = await ws.recv()
            print("SERVER:", reset_response)

        start_msg = {
            "type": "start",
            "source": "local_test",
            "scope": "public",
            "agentType": "gateway_test",
            "roomName": room_name,
            "participantId": participant_id,
            "displayName": display_name,
            "sampleRate": TARGET_SAMPLE_RATE,
            "encoding": "pcm_s16le",
            "channels": 1,
            "chunkMs": chunk_ms,
        }

        await ws.send(json.dumps(start_msg, ensure_ascii=False))

        receiver_task = asyncio.create_task(receive_messages(ws))

        print("Start streaming wav audio...")

        await send_audio_array(
            ws=ws,
            audio=audio_16k,
            chunk_samples=chunk_samples,
            chunk_ms=chunk_ms,
            realtime=realtime,
            label="audio",
        )

        if tail_silence_ms > 0:
            print(f"Sending tail silence: {tail_silence_ms}ms")

            silence_samples = int(TARGET_SAMPLE_RATE * tail_silence_ms / 1000)
            silence = np.zeros(silence_samples, dtype=np.float32)

            await send_audio_array(
                ws=ws,
                audio=silence,
                chunk_samples=chunk_samples,
                chunk_ms=chunk_ms,
                realtime=realtime,
                label="silence",
            )

        print("Finished sending audio. Sending stop message...")

        await ws.send(json.dumps({
            "type": "stop"
        }))

        print("Waiting for backend ASR result until server closes websocket...")

        receiver_result = None

        try:
            receiver_result = await asyncio.wait_for(receiver_task, timeout=wait_after_stop_sec)

        except asyncio.TimeoutError:
            print(f"Timeout after {wait_after_stop_sec}s. Closing client websocket.")

            receiver_task.cancel()

            try:
                receiver_result = await receiver_task
            except asyncio.CancelledError:
                pass

        if receiver_result:
            if receiver_result["saw_transcript"]:
                print("Smoke test completed: transcript received.")
            elif receiver_result["saw_asr_error"]:
                print("Smoke test completed: ASR error received.")
            else:
                print("Smoke test completed: no transcript or ASR error received.")

    print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Send a wav file as continuous pcm_s16le audio chunks to server_gateway.py"
    )

    parser.add_argument(
        "wav",
        type=str,
        help="Path to input wav file"
    )

    parser.add_argument(
        "--ws",
        type=str,
        default=DEFAULT_WS_URL,
        help=f"WebSocket URL. Default: {DEFAULT_WS_URL}"
    )

    parser.add_argument(
        "--room",
        type=str,
        default="heiohkwnjr",
        help="roomName metadata"
    )

    parser.add_argument(
        "--participant-id",
        type=str,
        default="test_user",
        help="participantId metadata"
    )

    parser.add_argument(
        "--display-name",
        type=str,
        default="Test User",
        help="displayName metadata"
    )

    parser.add_argument(
        "--chunk-ms",
        type=int,
        default=20,
        help="Chunk duration in ms. Default: 20"
    )

    parser.add_argument(
        "--tail-silence-ms",
        type=int,
        default=2000,
        help="Append silence after wav before sending stop. Default: 2000ms"
    )

    parser.add_argument(
        "--wait-after-stop-sec",
        type=int,
        default=30,
        help="Seconds to wait after sending stop so backend can return ASR result. Default: 30"
    )

    parser.add_argument(
        "--no-realtime",
        action="store_true",
        help="Send as fast as possible instead of real-time"
    )

    parser.add_argument(
        "--reset-outputs",
        action="store_true",
        help="Ask the backend to delete existing output wav/transcript files before sending audio."
    )

    args = parser.parse_args()

    wav_path = Path(args.wav)

    if not wav_path.exists():
        raise FileNotFoundError(f"Wav file not found: {wav_path}")

    asyncio.run(
        stream_wav_to_gateway(
            wav_path=wav_path,
            ws_url=args.ws,
            room_name=args.room,
            participant_id=args.participant_id,
            display_name=args.display_name,
            chunk_ms=args.chunk_ms,
            realtime=not args.no_realtime,
            tail_silence_ms=args.tail_silence_ms,
            wait_after_stop_sec=args.wait_after_stop_sec,
            reset_outputs=args.reset_outputs,
        )
    )


if __name__ == "__main__":
    main()
