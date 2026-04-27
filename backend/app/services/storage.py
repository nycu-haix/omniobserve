import asyncio

from ..config import AUDIO_STORAGE_DIR
from ..models import FileFormat


async def save_audio_to_local_storage(
    *,
    session_id: str,
    audio_segment_id: str,
    file_format: FileFormat,
    audio_bytes: bytes,
) -> str:
    file_path = AUDIO_STORAGE_DIR / session_id / f"{audio_segment_id}.{file_format.value}"
    await asyncio.to_thread(file_path.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(file_path.write_bytes, audio_bytes)
    return str(file_path)
