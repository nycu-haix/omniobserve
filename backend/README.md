# Backend WebSocket Endpoints

This backend exposes the production WebSocket endpoints under `/ws/sessions/{session_id}/...`.

All production WebSocket endpoints use the same participant addressing pattern:

```text
connections[session_id][participant_id] = websocket
```

For local testing, replace `wss://meet.omni.elvismao.com` with `ws://localhost:8000`.

## Endpoint Summary

| Endpoint                                              | Purpose                                        | Client data                          | Server delivery                                      |
| ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `/ws/sessions/{session_id}/audio?participant_id=`     | Private/public audio stream to STT             | JSON control + binary PCM            | Sends transcript only to the same participant        |
| `/ws/sessions/{session_id}/board?participant_id=`     | Board state sync, ranking moves, block updates | JSON                                 | Broadcasts board/ranking updates to the same session |
| `/ws/sessions/{session_id}/cue?participant_id=`       | Similarity cue channel                         | JSON                                 | Sends cue messages to targeted participant           |
| `/ws/sessions/{session_id}/presence?participant_id=`  | Presence and ambient activity                  | JSON                                 | Broadcasts presence/activity to the same session     |
| `/sessions/{session_id}/audio-stream?participant_id=` | Legacy audio stream endpoint                   | JSON start/stop + binary Float32 PCM | Sends transcript updates to the same connection      |

## 1. Audio WebSocket

```text
wss://meet.omni.elvismao.com/ws/sessions/{session_id}/audio?participant_id={participant_id}
```

Local:

```text
ws://localhost:8000/ws/sessions/mars-survival-001/audio?participant_id=1
```

Initial join message:

```json
{
	"type": "join",
	"participant_id": "1",
	"sample_rate": 16000,
	"mic_mode": "private"
}
```

Supported client messages:

```json
{ "type": "join", "participant_id": "1", "sample_rate": 16000, "mic_mode": "private" }
{ "type": "speaking_start" }
{ "type": "speaking_end" }
{ "type": "ping" }
```

Binary messages are treated as PCM audio bytes. When enough bytes are buffered, or when `speaking_end` arrives, the server flushes the buffer to STT.

Server messages:

```json
{
	"type": "joined",
	"session_id": "mars-survival-001",
	"participant_id": "1"
}
```

```json
{
	"type": "transcript",
	"participant_id": "1",
	"mic_mode": "private",
	"text": "transcribed text",
	"segment_id": "seg_123",
	"timestamp_ms": 1714300000000
}
```

```json
{
	"type": "transcript_error",
	"segment_id": null,
	"reason": "stt_error"
}
```

Backend logs to watch:

```text
audio ws connected session_id=... participant_id=...
audio ws join session_id=... participant_id=... sample_rate=... mic_mode=...
audio ws speaking_start session_id=... participant_id=...
audio ws flush session_id=... participant_id=... bytes=...
audio ws transcript session_id=... participant_id=... segment_id=...
```

## 2. Board WebSocket

```text
wss://meet.omni.elvismao.com/ws/sessions/{session_id}/board?participant_id={participant_id}
```

Local:

```text
ws://localhost:8000/ws/sessions/mars-survival-001/board?participant_id=1
```

Initial join message:

```json
{
	"type": "join",
	"participant_id": "1"
}
```

Supported client messages:

```json
{ "type": "join", "participant_id": "1" }
{ "type": "ping" }
```

Ranking move:

```json
{
	"type": "ranking_move",
	"itemId": "oxygen",
	"toIndex": 2,
	"baseRevision": 12
}
```

Block publish:

```json
{
	"type": "block_publish",
	"block_id": "blk_007",
	"participant_id": "1",
	"content": "Public idea content",
	"linked_cue_id": "cue_003"
}
```

Block discard:

```json
{
	"type": "block_discard",
	"block_id": "blk_007",
	"participant_id": "1"
}
```

Block edit:

```json
{
	"type": "block_edit",
	"block_id": "blk_007",
	"participant_id": "1",
	"content": "Updated private idea content"
}
```

Server messages:

```json
{
	"type": "joined",
	"session_id": "mars-survival-001",
	"participant_id": "1"
}
```

```json
{
	"type": "board_state",
	"session_id": "mars-survival-001",
	"revision": 12,
	"ranking": {
		"items": ["oxygen", "water", "map", "radio", "food"]
	},
	"public_blocks": [],
	"private_blocks": []
}
```

```json
{
	"type": "ranking_state",
	"revision": 13,
	"items": ["water", "oxygen", "map", "radio", "food"],
	"updatedBy": "1"
}
```

Ranking updates are serialized by a per-session lock:

```text
session_locks[session_id]
```

Backend logs to watch:

```text
board ws connected session_id=... participant_id=...
board ws join session_id=... participant_id=...
ranking_move received session_id=... participant_id=... item_id=... to_index=...
ranking_state broadcast session_id=... revision=... updated_by=...
board ws disconnected session_id=... participant_id=...
```

## 3. Cue WebSocket

```text
wss://meet.omni.elvismao.com/ws/sessions/{session_id}/cue?participant_id={participant_id}
```

Local:

```text
ws://localhost:8000/ws/sessions/mars-survival-001/cue?participant_id=1
```

Initial join message:

```json
{
	"type": "join",
	"participant_id": "1"
}
```

Supported client messages:

```json
{ "type": "join", "participant_id": "1" }
{ "type": "ping" }
```

Cue response:

```json
{
	"type": "cue_response",
	"cue_id": "cue_003",
	"participant_id": "1",
	"response": "support",
	"timestamp_ms": 1714300002000
}
```

Current server responses:

```json
{
	"type": "joined",
	"session_id": "mars-survival-001",
	"participant_id": "1"
}
```

```json
{
	"type": "cue_response_recorded",
	"cue_id": "cue_003"
}
```

The manager supports targeted delivery through:

```python
cue_manager.send_to(session_id, participant_id, message)
```

## 4. Presence WebSocket

```text
wss://meet.omni.elvismao.com/ws/sessions/{session_id}/presence?participant_id={participant_id}
```

Local:

```text
ws://localhost:8000/ws/sessions/mars-survival-001/presence?participant_id=1
```

Initial join message:

```json
{
	"type": "join",
	"participant_id": "1"
}
```

Supported client messages:

```json
{ "type": "join", "participant_id": "1" }
{ "type": "ping" }
```

Activity message:

```json
{
	"type": "activity",
	"participant_id": "1",
	"context": "private_board"
}
```

Server messages:

```json
{
	"type": "presence_state",
	"session_id": "mars-survival-001",
	"participants": ["1", "2"]
}
```

```json
{
	"type": "participant_joined",
	"participant_id": "2",
	"total": 2
}
```

```json
{
	"type": "participant_left",
	"participant_id": "2",
	"total": 1
}
```

```json
{
	"type": "someone_typing",
	"context": "private_board"
}
```

## 5. Legacy Audio Stream

```text
wss://meet.omni.elvismao.com/sessions/{session_id}/audio-stream?participant_id={participant_id}
```

Local:

```text
ws://localhost:8000/sessions/mars-survival-001/audio-stream?participant_id=1
```

This is the older official audio route. It is still kept for compatibility.

The first message must be:

```json
{
	"type": "start",
	"scope": "private",
	"sampleRate": 16000,
	"channels": 1,
	"encoding": "float32"
}
```

Then send Float32 PCM binary messages. To flush and close:

```json
{
	"type": "stop"
}
```

Server transcript messages use:

```json
{
	"type": "transcript_update",
	"transcript_segment_id": "seg_123",
	"text": "transcribed text",
	"is_final": false
}
```

## Test Gateway Endpoint

The `audio-test/vad-backend` server has a separate test-only endpoint:

```text
ws://localhost:8000/ws/audio
```

This route is defined in:

```text
audio-test/vad-backend/server_gateway.py
```

It is not the production backend route. The production backend routes are in:

```text
backend/app/routes/ws.py
```

## Frontend Board Connection

The current frontend ranking task connects to the board WebSocket from:

```text
frontend/src/hooks/useWebSocket.ts
```

The URL is built from:

```env
VITE_WS_BASE_URL=ws://localhost:8000
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
VITE_DEFAULT_ROOM_NAME=mars-survival-001
```

For production:

```env
VITE_WS_BASE_URL=wss://meet.omni.elvismao.com
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
VITE_DEFAULT_ROOM_NAME=skyishandsome
```

The session id and participant id come from the URL query:

```text
https://omni.elvismao.com?room_name=skyishandsome&id=1
https://omni.elvismao.com?room_name=skyishandsome&id=2
```

The frontend uses `room_name` as the WebSocket `session_id` and also builds the Jitsi meeting URL:

```text
Jitsi URL: https://meet.omni.elvismao.com/{room_name}
Board WS: wss://meet.omni.elvismao.com/ws/sessions/{room_name}/board?participant_id={id}
```

If `room_name` is missing, the frontend falls back to `VITE_DEFAULT_ROOM_NAME`.

## Browser Verification

In Chrome DevTools:

1. Open `Network`.
2. Filter by `WS`.
3. Open the board WebSocket.
4. Check `Messages`.

Message direction:

```text
Up arrow: browser to backend
Down arrow: backend to browser
```

Expected board sequence:

```text
up   {"type":"join","participant_id":"1"}
down {"type":"joined",...}
down {"type":"board_state",...}
up   {"type":"ranking_move",...}
down {"type":"ranking_state",...}
```
