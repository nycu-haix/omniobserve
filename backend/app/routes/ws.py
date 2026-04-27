from fastapi import APIRouter, Query, WebSocket

from ..services.streaming import handle_audio_stream_websocket

router = APIRouter()


@router.websocket("/sessions/{session_id}/audio-stream")
async def audio_stream_websocket(
    websocket: WebSocket,
    session_id: str,
    participant_id: str = Query(...),
) -> None:
    await handle_audio_stream_websocket(
        websocket,
        session_id=session_id,
        participant_id=participant_id,
    )
