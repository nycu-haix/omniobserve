import asyncio

from ..config import logger
from ..schemas import ApiError

try:
    from breeze_asr import transcribe
except ImportError:
    # Fallback stub so this module imports cleanly even before ASR wiring is installed.
    def transcribe(audio_bytes: bytes) -> str:
        raise RuntimeError("Breeze ASR integration is not available")


async def transcribe_audio(audio_bytes: bytes) -> str:
    try:
        text = await asyncio.to_thread(transcribe, audio_bytes)
    except Exception as exc:
        raise ApiError(422, "STT_FAILED", "Audio could not be transcribed") from exc

    if not text or not text.strip():
        raise ApiError(422, "STT_FAILED", "Audio could not be transcribed")

    return text.strip()


async def transcribe_ws_chunk(chunk_bytes: bytes) -> str | None:
    try:
        transcript_text = await asyncio.to_thread(transcribe, chunk_bytes)
    except Exception as exc:
        logger.exception("transcribe() failed during WebSocket streaming: %s", exc)
        return None

    if not transcript_text or not transcript_text.strip():
        return None

    return transcript_text.strip()
