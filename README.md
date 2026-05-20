# OmniObserve

An online meeting facilitator unveiling hidden consensus — 整合視訊會議、語音辨識（ASR）與 AI 輔助觀察的協作研究平台。

核心設計採用 **front–back channel framework**：參與者透過輕量的私人語音輸入（back channel）產生 Idea Blocks，系統跨參與者偵測相似想法並以匿名方式推播 Similarity Cue，幫助潛在共識浮現到公開討論（front channel），而不強制揭露身份或內容。

## Motivation

團體腦力激盪在課堂與職場廣泛使用，但常因隱藏的群體動力而效果不彰。研究顯示參與者傾向於隱藏疑慮和新想法，導致最有價值的洞察從未浮現。現有的 AI 輔助工具僅關注公開討論內容（如群組聊天、即時轉錄），忽略私人層次的訊號。

## Key Hypotheses

- **H1**: Awareness of shared unspoken thoughts increases confidence in expressing own opinion.
- **H2**: Idea Blocks provide structured representations of participants' private thoughts by transforming their spoken or written input during the individual ideation phase.

## Design Considerations

- **D1: Reduce cognitive load** → Enable lightweight input (quick voice) to capture ideas with minimal effort
- **D2: Preserve agency** → The system supports but does not enforce transitions to public discussion

## Preliminary Study Findings

來自遠端 between-subjects 先導研究的初步發現（N=6, 3 人/組 × 2 組，每組含 1 名 confederate 提出看似合理但錯誤的論點）：

| Finding | Description |
|---------|-------------|
| **F1: Similarity creates social support** | Similarity cues 讓部分參與者在發言前感受到支持，降低成爲唯一持某觀點者的風險。*"I could secretly check if anyone thought the same... I knew there are people who would back me up."* — P1 |
| **F2: Silence is strategic** | 不發言不一定代表沒想法。部分參與者偏好補充既有討論而非發起新話題。*"I would wait until someone else mentioned it first, then I would add my reason."* — P2 |
| **F3: Cue meaning depends on participation style** | 同樣的 cue 對不同人有不同意義：有人將其視爲補充邀請，有人只被多數共鳴或完全相同的主張所驅動。 |

## Architecture

```
Frontend (React 19 + Vite) ──WebSocket──▶ Backend (FastAPI)
       │                                        │
       ├─ Jitsi Meet (video)                    ├─ Breeze ASR (STT)
       ├─ Board WS (ranking sync)               ├─ OpenAI / Ollama (LLM, Embedding)
       ├─ Audio WS (PCM streaming)              ├─ PostgreSQL + pgvector
       ├─ Presence WS                           └─ Ollama (bge-m3 embedding)
       └─ Admin WS (monitor/control)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS, Radix UI (shadcn/ui), @dnd-kit, @jitsi/react-sdk, Lucide |
| Backend | Python, FastAPI, SQLAlchemy (async), Alembic |
| Database | PostgreSQL 16 + pgvector |
| ASR | Breeze ASR (internal STT model) |
| LLM | OpenCode Go / OpenAI-compatible (qwen3.6-plus) |
| Embedding | Ollama (bge-m3) or OpenAI |
| Infra | Docker, nginx, Jitsi Meet |

## Task: Lost at Sea

The "Lost at Sea" survival ranking task — 參與者針對海上求生情境中的 15 項物品（六分儀、20L 飲用水、蚊帳、太平洋地圖、釣魚工具組等）進行重要性排序。此任務特意設計以引發異議、少數觀點與競爭性理由。

任務配置在 `backend/app/task_config/lost_at_sea.py`，前端透過 `GET /api/task-config` 取得。

## Research Study

遠端 between-subjects 先導研究設計：

| Aspect | Detail |
|--------|--------|
| Participants | N=6 naive (3 per group × 2 groups), each group included 1 confederate |
| Confederates | Presented plausible-but-incorrect arguments to elicit private disagreement |
| Conditions | **Control**: private audio capture only, no AI cues. **Experimental**: AI facilitation enabled (similarity detection + cues) |

### Session Flow

```
Individual (8 min) → Group Discussion (20 min) → Reflection (2 min) → Interview (~30 min)
```

由管理員透過 Admin Page 控制兩階段切換：

1. **Private Phase**（≈8 min）— 參與者獨立思考，以語音輸入產生 Idea Blocks，各自排序，Similarity Cue **不**推送
2. **Group Phase**（≈20 min）— 小組視訊討論達成共識，顯示 Public 排序與 Private 排序的差異對比，Similarity Cue 開始推送

管理員可設定倒數計時器控制各階段時間。

## WebSocket Routes

| Endpoint | Purpose |
|----------|---------|
| `/ws/sessions/{name}/board` | 排序同步、Idea Block 廣播、公開聊天 |
| `/ws/sessions/{name}/audio` | 即時語音串流 → STT → Private Board |
| `/ws/sessions/{name}/cue` | Similarity Cue 回應通道 |
| `/ws/sessions/{name}/presence` | 參與者狀態（在線、打字中、麥克風狀態） |
| `/ws/sessions/{name}/admin` | 管理員監控與控制（切換 phase、倒數、cue condition） |
| `/ws/sessions/{name}/transcript-segments` | 逐字稿分段串流 + LLM pipeline |
| `/sessions/{name}/audio-stream` | 舊版音訊串流（legacy） |

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/task-config` | 任務設定與物品清單 |
| GET | `/api/topic-description` | 任務主題敘述 |
| POST | `/sessions/{name}/users/{id}/idea-blocks/generate` | LLM 從逐字稿生成 Idea Blocks |
| POST | `/api/board/block` | 前端 board block 生成 |
| PATCH | `/api/board/idea-blocks/{id}` | 編輯 Idea Block |
| POST | `/api/board/mock-seed` | 測試用 mock 資料注入 |
| GET | `/api/sessions/{name}/presence` | 取得 session 參與者狀態 |

完整 API 文件見 `backend/app/routes/` 與 OpenAPI schema（啟動後瀏覽 `/docs`）。

## Core Backend Services

### Idea Block Pipeline

```
Audio → Breeze ASR → Transcript → LLM → Idea Blocks → Embedding (bge-m3) → 
  Task Item Matching → Similarity Detection → Similarity Cue Notification
```

核心流程：
1. 音訊透過 WebSocket 串流到後端，Breeze ASR 轉爲逐字稿
2. 逐字稿累積到段落後，送 LLM 生成 Idea Blocks（每個 block 含 content/summary/transcript）
3. 每個 Idea Block 產生 embedding vector，存入 pgvector
4. 自動觸發相似性偵測（跨參與者）

### Similarity Detection

- 透過 **Task Item** 關聯縮小候選範圍（討論同一物品的想法）
- **Cosine Similarity**（threshold 0.7）過濾語義相近者
- **LLM** 最終判斷 ranking stance 是否相容，並分類爲：
  - `is_same_reason: true` — 相同理由（Same Idea Block）
  - `is_same_reason: false` — 不同理由但 ranking stance 相容（Same Conclusion, Different Reasoning）
- 相似配對建立後，透過 Cue WebSocket 推播 Similarity Cue 給雙方

### Similarity Cue

當系統偵測到兩名參與者的 Idea Block 滿足以下條件時，觸發匿名 Similarity Cue：

- **Same Idea Block** — 持有相同 idea block（同一結論 + 同一理由）
- **Same Conclusion, Different Reasoning** — 達成相同結論但透過不同理由

Cue 以匿名方式推送給雙方（不揭露對方身份或內容），僅提示「有人持有相關觀點」。目的是讓參與者在進入公開討論前感受到潛在支持。

Cue condition 可由管理員切換 `experimental`（推送 cue）/ `control`（不推送）。

## Admin Dashboard

路徑 `/admin`（需帶 `room_name` query），提供：

- **Connection Status** — Board、Admin、Presence WebSocket 連線狀態
- **Phase Controls** — 切換 Private/Group Phase
- **Countdown Timer** — 設定階段倒數
- **Cue Condition** — 切換實驗組 / 對照組
- **Live Transcripts** — 各參與者即時逐字稿
- **Idea Blocks** — 檢視所有參與者生成的 Idea Block
- **Manual Cue** — 管理員手動建立相似配對
- **Public Chat** — 公開聊天室
- **Ranking Export** — 匯出 CSV 排名對比表

## Frontend

前端使用 React 19 + Vite 8 + TypeScript + Tailwind CSS。

頁面透過 URL query 參數控制：

| Param | Description |
|-------|-------------|
| `room_name` | Session / Jitsi room 名稱 |
| `id` | 參與者 ID（必須爲整數） |
| `name` | 顯示名稱 |

範例：`https://omni.elvismao.com/?room_name=lost-at-sea&id=1&name=Alice`

### Key UI Components

- **MeetingRoom** — 主會議頁面，含 Jitsi 視訊、Public/Private 排序面板、麥克風控制
- **PrivateBoard** — 側邊欄，含逐字稿、Idea Block 清單、Similarity Cue 提示、公開聊天
- **AdminPage** — 管理員後臺監控面板

### Quick Start

```bash
cd frontend
pnpm install
pnpm dev        # 開發模式
pnpm build      # 正式建置
```

## Backend

### Quick Start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn omniobserve_api:app --host 0.0.0.0 --port 8000
```

### Docker Deployment

```bash
cd backend
docker compose up -d    # 啓動 PostgreSQL + Ollama + Backend
```

## Local Full Stack

本機如果要把前端、後端、DB、Ollama、audio-test ASR gateway 都放在同一個 Docker Desktop project 裡，從 repo root 啟動：

```bash
docker compose -p omniobserve-local -f docker-compose.local.yml up --build
```

這個本機 stack 會啟動：

| Service | URL / Port | Purpose |
|---------|------------|---------|
| Frontend | `http://127.0.0.1:5177` | OmniObserve Vite app |
| Backend | `http://127.0.0.1:8000` | FastAPI API + board WebSockets |
| VAD/ASR gateway | `http://127.0.0.1:8001` | `audio-test/vad-backend` diagnostic page and `/sessions/{id}/audio-stream` |
| Audio static tests | `http://127.0.0.1:3001` | Legacy audio-test static pages |
| Jitsi Meet | `https://meet.omni.elvismao.com` | Remote meeting UI used by the frontend |
| Postgres | `127.0.0.1:5433` | Local DB |
| Ollama | `127.0.0.1:11434` | Local embedding service |

The frontend in this stack is configured with:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_WS_BASE_URL=ws://127.0.0.1:8000
VITE_AUDIO_WS_BASE_URL=ws://127.0.0.1:8001
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
```

The frontend is published on host port `5177` by default to avoid common local Vite ports `5173-5176`. Override it with `FRONTEND_PORT=...` if needed.

`audio-test` remains available as a standalone diagnostic stack, and `backend/`, `frontend/`, `meet/` keep their separate Compose files for Dokploy deployment. The root `docker-compose.local.yml` is only the local all-in-one entrypoint.

On macOS, the ASR gateway uses `audio-test/vad-backend/Dockerfile.omni-local` and defaults to the real Breeze ASR model, `MediaTek-Research/Breeze-ASR-25`. The first startup downloads the Hugging Face model into the `model_cache` Docker volume and can take several minutes:

```bash
docker compose -p omniobserve-local -f docker-compose.local.yml logs -f vad-backend
curl http://127.0.0.1:8001/asr-status
```

Set `ASR_MOCK=1` if you want a fast local smoke test that returns `local mock transcript` without loading Breeze. Set `ASR_DEVICE=cpu` to force CPU, or leave `ASR_DEVICE=auto` to use CUDA if Docker exposes a GPU.

Local Jitsi is optional. By default the frontend uses `https://meet.omni.elvismao.com`. To test the local Jitsi containers instead:

```bash
VITE_JITSI_BASE_URL=http://127.0.0.1:8088 \
JITSI_INTERNAL_BASE_URL=http://meet-web \
docker compose -p omniobserve-local -f docker-compose.local.yml --profile local-meet up --build
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/omniobserve` | PostgreSQL 連線字串 |
| `OPENAI_API_KEY` | - | OpenCode Go API key（LLM + similarity detection） |
| `OPENAI_MODEL` | `qwen3.6-plus` | LLM 模型 |
| `OPENAI_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama embedding 服務 |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | Embedding 模型 |
| `SKIP_DB_STARTUP` | `false` | 跳過資料庫初始化 |
| `RESET_DB_ON_STARTUP` | `false` | 啓動時重置資料庫 |
| `CORS_ALLOWED_ORIGINS` | `*` | CORS 允許來源 |

---

# Production Test Notes

Below is the deployment/testing checklist for running with the real backend, Jitsi, WebSocket, database, and Breeze ASR.

## Frontend Environment

Set these values in `frontend/.env` before starting or building the frontend:

```env
VITE_WS_BASE_URL=wss://meet.omni.elvismao.com
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
VITE_DEFAULT_ROOM_NAME=lost-at-sea
```

For local WebSocket testing, use:

```env
VITE_WS_BASE_URL=ws://localhost:8000
VITE_JITSI_BASE_URL=https://meet.omni.elvismao.com
VITE_DEFAULT_ROOM_NAME=lost-at-sea
```

Restart the Vite dev server after changing `.env`.

```bash
cd frontend
pnpm dev
```

Open multiple participants with the same `room_name` and different query ids. The `room_name` query value is the WebSocket session id and the Jitsi room name.

```text
http://localhost:5173/?room_name=lost-at-sea&id=1
http://localhost:5173/?room_name=lost-at-sea&id=2
http://localhost:5173/?room_name=lost-at-sea&id=3
http://localhost:5173/?room_name=lost-at-sea&id=4
```

In production, the page URL follows the same pattern:

```text
https://omni.elvismao.com?room_name=lost-at-sea&id=1
```

This creates:

```text
Jitsi URL: https://meet.omni.elvismao.com/lost-at-sea
Board WS: wss://meet.omni.elvismao.com/ws/sessions/lost-at-sea/board?participant_id=1
```

## Backend Environment

For production-like testing, do not enable `SKIP_DB_STARTUP`.

Required backend environment:

```bash
export DATABASE_URL="postgresql+asyncpg://postgres:postgres@<db-ip>:5432/omniobserve"
export OPENAI_API_KEY="<opencode-go-api-key>"
export OPENAI_BASE_URL="https://opencode.ai/zen/go/v1"
export OPENAI_MODEL="qwen3.6-plus"
```

If the OpenAI-compatible endpoint changes:

```bash
export OPENAI_BASE_URL="<base-url>"
```

Start the backend:

```bash
cd backend
python -m uvicorn omniobserve_api:app --host 0.0.0.0 --port 8000
```

For local board WebSocket testing without database startup:

```bash
export SKIP_DB_STARTUP="true"
python -m uvicorn omniobserve_api:app --host 0.0.0.0 --port 8000
```

Do not use `SKIP_DB_STARTUP=true` for the production-like test.

## Breeze ASR

The backend currently imports Breeze through:

```python
from breeze_asr import transcribe
```

Before production-like audio testing, confirm the backend Python environment can import it:

```bash
python -c "from breeze_asr import transcribe; print('breeze ok')"
```

If this fails, the audio WebSocket can still connect, but STT will fail and backend logs will show that Breeze ASR integration is unavailable.

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

For the legacy audio-stream endpoint, also proxy `/sessions/`:

```nginx
location /sessions/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

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
	"itemId": "sea_chart",
	"toIndex": 2,
	"baseRevision": 0
}
```

Expected server broadcast:

```json
{
	"type": "ranking_state",
	"revision": 1,
	"items": ["mosquito_net", "petrol", "sea_chart", "water_container", "vhf_radio"],
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
