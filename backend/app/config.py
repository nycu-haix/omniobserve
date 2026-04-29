import logging
import os
from pathlib import Path

logger = logging.getLogger("omniobserve")
logging.basicConfig(level=logging.INFO)

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/omniobserve"
)
SKIP_DB_STARTUP = os.getenv("SKIP_DB_STARTUP", "").lower() in {"1", "true", "yes", "on"}
AUDIO_STORAGE_DIR = Path(os.getenv("AUDIO_STORAGE_DIR", "./storage/audio"))
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "*",
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = os.getenv("CORS_ALLOW_CREDENTIALS", "").lower() in {"1", "true", "yes", "on"}
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")

STREAM_CHUNK_SAMPLES = 16000
FRONTEND_MOCK_TRANSCRIPT_LINES = [
    "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成回到母船，而不是在原地等待救援。",
    "氧氣一定要在前面吧，因為沒有氧氣的話，就算我們有地圖或食物也沒有時間使用。",
    "如果我們知道母船大概在哪，星圖可能比無線電重要；但如果完全不知道方向，無線電也許可以先確認位置。",
    "我剛剛想到水的消耗量可能跟路程時間有關，這段可以請 AI 幫我整理成新的想法。",
    "食物雖然重要，但短時間任務裡可能不是第一優先，應該排在氧氣和導航工具後面。",
]
FRONTEND_MOCK_TRANSCRIPT_TEXT = "\n".join(FRONTEND_MOCK_TRANSCRIPT_LINES)
MOCK_TRANSCRIPT_TEXT = os.getenv(
    "MOCK_TRANSCRIPT_TEXT",
    """[00:00] Host:
大家好，今天這場會議主要是要確認 OmniObserve 的即時音訊處理 API 要怎麼設計。前端目前希望可以把 Float32 PCM 音訊即時傳到後端，後端負責做語音轉文字，接著再把 transcript 接到 Private Board 或 Public Board。今天我們先聚焦三個重點：第一，前端音訊格式和 WebSocket API；第二，後端 STT pipeline；第三，逐字稿和 idea blocks 要怎麼接到 board 上。

[00:50] Jason:
我先確認一下目前的狀況。原本的 API spec 裡有 REST 的 `/audio-segments`，這個比較像是每隔幾秒上傳一段完整音檔，例如 wav 或 webm。但現在前端說會傳 Float32 PCM，所以這比較適合走 WebSocket，也就是 `/sessions/{session_id}/audio-stream`。前端會一直送 binary chunks，後端收到後累積或分段處理。

[01:35] Engineer A:
對，前端這邊目前比較偏向用 AudioWorklet 拿到 Float32Array。這些資料不是 wav 檔，也沒有 header，所以後端需要知道 sample rate 和 channels。前端可以在 WebSocket URL 上帶 query params，例如 `encoding=float32_pcm`、`sample_rate=48000`、`channels=1`。每次送出的 binary message 就是 Float32Array 的 ArrayBuffer。

[02:20] Engineer B:
這裡有一個重要點，STT model 通常不會直接吃 Float32 PCM bytes，尤其如果是一般 whisper 或其他 ASR pipeline，多半需要 wav file 或至少是正確格式的 audio array。所以後端收到 Float32 PCM 後，要先做格式轉換。最基本的做法是把 Float32 sample clip 到 -1 到 1，轉成 int16 PCM，然後包成 wav，再丟給 STT model。
""",
)

IDEA_BLOCK_SYSTEM_PROMPT = PROMPT_TEMPLATE = '''
<Role Assignment>
你是一位專業的會議記錄分析師，正在針對線上 brainstorming 會議中參與者的私人語音筆記進行結構化分析。
你的任務是閱讀參與者的逐字稿內容，並根據提供的 Principle 將其分割成適當的 idea blocks。在進行分割時，請嚴格遵守以下指導原則。
</Role Assignment>

<Task>
閱讀 <Context> 標籤中的逐字稿內容，並根據 <Principle> 中定義的準則將其分割成獨立的 idea blocks。
每個 idea block 應代表一個完整的想法或觀點，並輸出：
1) content：一句短總結（給前端顯示）
2) summary：詳細解釋 content（不要混入原逐字稿內容）
3) transcript：該 idea block 對應的逐字稿原文片段
</Task>

<Principle>
分割 IDEA BLOCK 的主要準則（一）：單一想法完整性（Thematic Singularity）

* **定義：**
  一個 IDEA BLOCK 必須僅包含關於**一個核心想法**或**一個特定觀點**。它應是一個獨立、完整、語義連貫的思考單元。
* **符合條件的情形：**
  當一段話完整表達了對某個議題的**特定看法**、**一個提案**或**一個論點**時，視為一個 IDEA BLOCK。即使語句較長，若所有部分都服務於同一核心想法，則不切割。
* **範例：**
  逐字稿：「我覺得我們應該先做使用者訪談，這樣才能確認需求方向是對的。」
  → 一個 IDEA BLOCK（提案 + 理由服務同一想法，不切割）

分割 IDEA BLOCK 的主要準則（二）：轉折與對比的切割（Semantic Connective Split）

* **定義：**
  當逐字稿中出現表示**轉折**、**對比**、**條件**或**並列不同論點**的語言結構（如：但是、不過、另外、雖然...但...、除此之外）時，應視為新 IDEA BLOCK 的起點。
* **符合條件的情形：**
  當連接詞後引導的內容，其主題或立場與前段**明顯不同或對立**時。
* **範例：**
  逐字稿：「這個功能設計上看起來很好，但我擔心實作時間不夠。」
  → IDEA BLOCK 1：「這個功能設計上看起來很好。」
  → IDEA BLOCK 2：「但我擔心實作時間不夠。」

分割 IDEA BLOCK 的主要準則（三）：功能性語句的分離（Functional Statement Separation）

* **定義：**
  當逐字稿同時包含**陳述想法**與**功能性語句**（如：疑問、建議、行動呼籲）時，功能性語句應獨立成一個 IDEA BLOCK。
* **符合條件的情形：**
  語句目的是**提出問題**、**建議行動**或**要求他人回應**，而非純粹陳述觀點。
* **範例：**
  逐字稿：「我們應該重新討論時程。這樣下去會來不及嗎？」
  → IDEA BLOCK 1：「我們應該重新討論時程。」（建議）
  → IDEA BLOCK 2：「這樣下去會來不及嗎？」（疑問）

分割 IDEA BLOCK 的主要準則（四）：猶豫與未說出口的想法（Hesitation & Unexpressed Idea）

* **定義：**
  當說話者**表達了一個想法但語帶猶豫**，或**有想法卻不確定是否說出口**時，仍應獨立成一個 IDEA BLOCK，因為這正是系統需要捕捉的核心情境。
* **符合條件的情形：**
  出現「我不確定該不該說」、「我有個想法但可能不成熟」、「我覺得...但不知道大家怎麼想」等語句。
* **範例：**
  逐字稿：「我有一個想法但我不確定合不合適，就是我們可以考慮改變整個架構。」
  → IDEA BLOCK 1：「我有一個想法但我不確定合不合適。」（猶豫/態度）
  → IDEA BLOCK 2：「我們可以考慮改變整個架構。」（實質提案）
</Principle>

<Context>
{transcript_text}
</Context>

<Formatting>
只回傳 JSON，不要有任何說明文字、markdown 或其他格式。

[
  {{
    "content": "一句短總結（前端顯示用）",
    "summary": "詳細解釋 content（不包含逐字稿原文）",
    "transcript": "對應逐字稿原文片段"
  }},
  {{
    "content": "...",
    "summary": "...",
    "transcript": "..."
  }}
]
</Formatting>
'''.strip()
