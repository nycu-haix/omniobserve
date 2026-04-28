from fastapi import APIRouter, Query, WebSocket

from ..services.realtime import (
    handle_audio_websocket,
    handle_board_websocket,
    handle_cue_websocket,
    handle_presence_websocket,
)
from ..services.streaming import handle_audio_stream_websocket

router = APIRouter()


@router.websocket("/ws/sessions/{session_id}/audio")
async def audio_websocket(
    websocket: WebSocket,
    session_id: str,
    participant_id: str = Query(...),
) -> None:
    await handle_audio_websocket(
        websocket,
        session_id=session_id,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_id}/board")
async def board_websocket(
    websocket: WebSocket,
    session_id: str,
    participant_id: str = Query(...),
) -> None:
    await handle_board_websocket(
        websocket,
        session_id=session_id,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_id}/cue")
async def cue_websocket(
    websocket: WebSocket,
    session_id: str,
    participant_id: str = Query(...),
) -> None:
    await handle_cue_websocket(
        websocket,
        session_id=session_id,
        participant_id=participant_id,
    )


@router.websocket("/ws/sessions/{session_id}/presence")
async def presence_websocket(
    websocket: WebSocket,
    session_id: str,
    participant_id: str = Query(...),
) -> None:
    await handle_presence_websocket(
        websocket,
        session_id=session_id,
        participant_id=participant_id,
    )


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
