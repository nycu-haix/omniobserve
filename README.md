# OmniObserve Production Test Notes

This document lists the required changes and checks before running a production-like test with the real backend, Jitsi URL, WebSocket endpoint, database, and Breeze ASR.

## Frontend Environment

Set these values in `frontend/.env` before starting or building the frontend:

```env
VITE_WS_BASE_URL=wss://meet.omni.elvismao.com
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
VITE_DEFAULT_ROOM_NAME=skyishandsome
```

For local WebSocket testing, use:

```env
VITE_WS_BASE_URL=ws://localhost:8000
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
VITE_DEFAULT_ROOM_NAME=mars-survival-001
```

Restart the Vite dev server after changing `.env`.

```powershell
cd frontend
pnpm dev
```

Open multiple participants with the same `room_name` and different query ids. The `room_name` query value is the WebSocket session id and the Jitsi room name.

```text
http://localhost:5173/?room_name=skyishandsome&id=1
http://localhost:5173/?room_name=skyishandsome&id=2
http://localhost:5173/?room_name=skyishandsome&id=3
http://localhost:5173/?room_name=skyishandsome&id=4
```

In production, the page URL follows the same pattern:

```text
https://omni.elvismao.com?room_name=skyishandsome&id=1
```

This creates:

```text
Jitsi URL: https://meet.omni.elvismao.com/skyishandsome
Board WS: wss://meet.omni.elvismao.com/ws/sessions/skyishandsome/board?participant_id=1
```

## Backend Environment

For production-like testing, do not enable `SKIP_DB_STARTUP`.

Required backend environment:

```powershell
$env:DATABASE_URL="postgresql+asyncpg://postgres:postgres@<db-ip>:5432/omniobserve"
$env:OPENAI_API_KEY="<openai-api-key>"
$env:OPENAI_MODEL="gpt-4.1-mini"
```

If the OpenAI-compatible endpoint is not the default OpenAI endpoint:

```powershell
$env:OPENAI_BASE_URL="<base-url>"
```

Start the backend:

```powershell
cd backend
python -m uvicorn omniobserve_api:app --host 0.0.0.0 --port 8000
```

For local board WebSocket testing without database startup:

```powershell
$env:SKIP_DB_STARTUP="true"
python -m uvicorn omniobserve_api:app --host 0.0.0.0 --port 8000
```

Do not use `SKIP_DB_STARTUP=true` for the production-like test.

## Breeze ASR

The backend currently imports Breeze through:

```python
from breeze_asr import transcribe
```

Before production-like audio testing, confirm the backend Python environment can import it:

```powershell
python -c "from breeze_asr import transcribe; print('breeze ok')"
```

If this fails, the audio WebSocket can still connect, but STT will fail and backend logs will show that Breeze ASR integration is unavailable.

## WebSocket Routes

Production WebSocket routes:

```text
/ws/sessions/{session_id}/audio?participant_id={participant_id}
/ws/sessions/{session_id}/board?participant_id={participant_id}
/ws/sessions/{session_id}/cue?participant_id={participant_id}
/ws/sessions/{session_id}/presence?participant_id={participant_id}
```

The frontend ranking task currently uses:

```text
/ws/sessions/{session_id}/board?participant_id={participant_id}
```

## Nginx Requirements

Nginx must proxy WebSocket upgrade requests to the backend. The `/ws/` path must preserve upgrade headers:

```nginx
location /ws/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

TLS should terminate at nginx, so the browser should connect with `wss://`.

## Confirm The Board WebSocket Is Connected

In browser DevTools:

1. Open `Network`.
2. Filter by `WS`.
3. Confirm the board connection returns `101 Switching Protocols`.
4. Open `Messages` or `Frames`.
5. Drag a ranking item.

Expected client message:

```json
{
	"type": "ranking_move",
	"itemId": "oxygen",
	"toIndex": 2,
	"baseRevision": 0
}
```

Expected server broadcast:

```json
{
	"type": "ranking_state",
	"revision": 1,
	"items": ["water", "map", "oxygen", "radio", "food"],
	"updatedBy": "1"
}
```

The browser console also logs:

```text
[board-ws] connecting
[board-ws] open
[board-ws] send
[board-ws] receive
[board-ws] close
```

The backend terminal logs:

```text
board ws connected session_id=... participant_id=...
board ws join session_id=... participant_id=...
ranking_move received session_id=... participant_id=...
ranking_state broadcast session_id=... revision=...
```

If participants see each other's ranking changes, the board WebSocket is connected and broadcasting.

## Common Issues

If the page shows `Public Meeting`, confirm the URL has `room_name` or `VITE_DEFAULT_ROOM_NAME` is set. The app builds the Jitsi URL as:

```text
{VITE_JITSI_BASE_URL}/{room_name}
```

If the frontend tries to connect to `ws://localhost:5173`, `VITE_WS_BASE_URL` is missing. Set it to the backend WebSocket origin.

If Chrome logs `WebSocket is closed before the connection is established` once during local Vite development, check `Network -> WS` before assuming failure. React development mode may briefly open and close an initial connection.
