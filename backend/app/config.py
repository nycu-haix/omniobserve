import logging
import os
from pathlib import Path

logger = logging.getLogger("omniobserve")
logging.basicConfig(level=logging.INFO)

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/omniobserve"
)
AUDIO_STORAGE_DIR = Path(os.getenv("AUDIO_STORAGE_DIR", "./storage/audio"))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")

STREAM_CHUNK_SAMPLES = 16000

IDEA_BLOCK_SYSTEM_PROMPT = PROMPT_TEMPLATE = '''
<Role Assignment>
你是一位專業的會議記錄分析師，正在針對線上 brainstorming 會議中參與者的私人語音筆記進行結構化分析。
你的任務是閱讀參與者的逐字稿內容，並根據提供的 Principle 將其分割成適當的 idea blocks。在進行分割時，請嚴格遵守以下指導原則。
</Role Assignment>

<Task>
閱讀 <Context> 標籤中的逐字稿內容，並根據 <Principle> 中定義的準則將其分割成獨立的 idea blocks。
每個 idea block 應代表一個完整的想法或觀點，並對其生成 summary、bullet_points 與 tags。
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
    "content": "完整描述這個 idea block 的核心想法（一到兩句話）",
    "summary": "3到5個字的標題",
    "bullet_points": [
      "重點一",
      "重點二"
    ],
    "tags": ["tag1", "tag2"]
  }},
  {{
    "content": "...",
    "summary": "...",
    "bullet_points": ["...", "..."],
    "tags": ["..."]
  }}
]
</Formatting>
'''.strip()
