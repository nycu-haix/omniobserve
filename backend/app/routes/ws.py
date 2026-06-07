from fastapi import APIRouter, Query, WebSocket

from ..config import ENABLE_BUILTIN_AUDIO_STREAM
from ..services.realtime import (
    handle_admin_websocket,
    handle_audio_websocket,
    handle_board_websocket,
    handle_cue_websocket,
    handle_presence_websocket,
)
from ..services.streaming import handle_audio_stream_websocket, handle_transcript_segments_websocket

router = APIRouter()


@router.websocket("/ws/sessions/{session_name}/admin")
async def admin_websocket(
    websocket: WebSocket,
    session_name: str,
    admin_id: str = Query("admin"),
) -> None:
    await handle_admin_websocket(
        websocket,
        session_id=session_name,
        admin_id=admin_id,
    )


@router.websocket("/ws/sessions/{session_name}/audio")
async def audio_websocket(
    websocket: WebSocket,
    session_name: str,
    participant_id: str = Query(...),
) -> None:
    await handle_audio_websocket(
        websocket,
        session_id=session_name,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_name}/board")
async def board_websocket(
    websocket: WebSocket,
    session_name: str,
    participant_id: str = Query(...),
) -> None:
    await handle_board_websocket(
        websocket,
        session_id=session_name,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_name}/cue")
async def cue_websocket(
    websocket: WebSocket,
    session_name: str,
    participant_id: str = Query(...),
) -> None:
    await handle_cue_websocket(
        websocket,
        session_id=session_name,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_name}/presence")
async def presence_websocket(
    websocket: WebSocket,
    session_name: str,
    participant_id: str = Query(...),
) -> None:
    await handle_presence_websocket(
        websocket,
        session_id=session_name,
        participant_id=participant_id,
    )


@router.websocket("/sessions/{session_name}/audio-stream")
async def audio_stream_websocket(
    websocket: WebSocket,
    session_name: str,
    participant_id: str = Query(...),
) -> None:
    if not ENABLE_BUILTIN_AUDIO_STREAM:
        await websocket.accept()
        await websocket.send_json({
            "type": "asr_error",
            "error": "Audio streaming is served by the ASR gateway. Set VITE_AUDIO_WS_BASE_URL to the gateway route.",
            "reason": "audio_gateway_required",
        })
        await websocket.close(code=1013, reason="audio_gateway_required")
        return
    await handle_audio_stream_websocket(
        websocket,
        session_name=session_name,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_name}/transcript-segments")
async def transcript_segments_websocket(
    websocket: WebSocket,
    session_name: str,
    participant_id: str = Query(...),
) -> None:
    await handle_transcript_segments_websocket(
        websocket,
        session_name=session_name,
        participant_id=participant_id,
    )
