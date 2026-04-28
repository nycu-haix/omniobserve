import asyncio
import io
import wave

from ..config import logger

try:
    from breeze_asr import transcribe
except ImportError:

    def transcribe(audio_bytes: bytes) -> str:
        raise RuntimeError("Breeze ASR integration is not available")


def pcm16_to_wav_bytes(*, pcm16_bytes: bytes, sample_rate: int, channels: int) -> bytes:
    with io.BytesIO() as wav_buffer:
        with wave.open(wav_buffer, "wb") as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm16_bytes)
        return wav_buffer.getvalue()


async def transcribe_ws_chunk(*, pcm16_bytes: bytes, sample_rate: int, channels: int) -> str | None:
    if not pcm16_bytes:
        return None

    wav_bytes = pcm16_to_wav_bytes(
        pcm16_bytes=pcm16_bytes,
        sample_rate=sample_rate,
        channels=channels,
    )

    try:
        transcript_text = await asyncio.to_thread(transcribe, wav_bytes)
    except Exception as exc:
        logger.exception("Breeze-ASR failed during WebSocket streaming: %s", exc)
        return None

    if not transcript_text or not transcript_text.strip():
        return None

    return transcript_text.strip()
