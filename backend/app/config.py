import logging
import os
from pathlib import Path

logger = logging.getLogger("omniobserve")
logging.basicConfig(level=logging.INFO)

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/omniobserve"
)
SKIP_DB_STARTUP = os.getenv("SKIP_DB_STARTUP", "").lower() in {"1", "true", "yes", "on"}
RESET_DB_ON_STARTUP = os.getenv("RESET_DB_ON_STARTUP", "").lower() in {"1", "true", "yes", "on"}
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
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "bge-m3")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "30"))

STREAM_CHUNK_SAMPLES = 16000
FRONTEND_MOCK_TRANSCRIPT_LINES = [
    "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成等待救援，而不是自己航行到岸邊。",
    "裝水容器一定要在前面吧，因為沒有淡水的話，就算我們有海圖或食物也撐不了太久。",
    "如果我們知道救援船大概在哪，VHF 無線電可能比海圖重要；但如果完全不知道方向，海圖也許可以先幫我們確認位置。",
    "我剛剛想到水的消耗量可能跟路程時間有關，這段可以請 AI 幫我整理成新的想法。",
    "食物雖然重要，但短時間求生裡可能不是第一優先，應該排在淡水和求救工具後面。",
]
FRONTEND_MOCK_TRANSCRIPT_TEXT = "\n".join(FRONTEND_MOCK_TRANSCRIPT_LINES)
TOPIC_DESCRIPTION = """你和幾位朋友租了一艘遊艇，準備橫越大西洋，進行一次難得的海上旅程。由於你們都沒有足夠的航海經驗，因此船上有一位經驗豐富的船長，以及兩位船員協助航行。

不幸的是，在航行到大西洋中央時，船上的廚房突然發生嚴重火災。船長與船員在試圖滅火的過程中失蹤，遊艇也受到嚴重損壞，正在慢慢下沉。

火災也破壞了重要的導航與通訊設備，因此你們無法準確知道目前的位置。你們只能大致估計：自己距離最近的陸地還有數百英里。

在遊艇完全沉沒前，你們成功救出一艘橡皮救生艇、一盒火柴，以及下列 15 項物品。這些物品都沒有受損，可以正常使用。

你們的任務是：**依照這些物品對「等待救援並存活下來」的重要性進行排序。**

請將最重要的物品標為 **1**，第二重要的標為 **2**，依此類推，直到最不重要的物品標為 **15**。"""

LLM_TOPIC_DESCRIPTION = """你和幾位朋友租了一艘遊艇，準備橫越大西洋，進行一次難得的海上旅程。由於你們都沒有足夠的航海經驗，因此船上有一位經驗豐富的船長，以及兩位船員協助航行。

不幸的是，在航行到大西洋中央時，船上的廚房突然發生嚴重火災。船長與船員在試圖滅火的過程中失蹤，遊艇也受到嚴重損壞，正在慢慢下沉。

火災也破壞了重要的導航與通訊設備，因此你們無法準確知道目前的位置。你們只能大致估計：自己距離最近的陸地還有數百英里。

在遊艇完全沉沒前，你們成功救出一艘橡皮救生艇、一盒火柴，以及下列 15 項物品。這些物品都沒有受損，可以正常使用。

你們的任務是：**依照這些物品對「等待救援並存活下來」的重要性進行排序。**

請將最重要的物品標為 **1**，第二重要的標為 **2**，依此類推，直到最不重要的物品標為 **15**。
## 任務流程

### 第一階段：個人排序

請先獨立思考，不要和其他人討論。

根據你自己的判斷，將 15 項物品依照重要性排序。

請注意：

你的目標不是航行到陸地，而是**在海上等待救援並提高生存機率**。

### 第二階段：小組共識排序

完成個人排序後，請和小組成員討論。

你們需要共同產生一份小組排序。

小組排序不一定要完全符合任何一位成員的個人排序，但每個成員的意見都應該被聽見。你們需要透過討論、說服、妥協，形成一份大家都能接受的共同排序。

---

# 物品清單
蚊帳
一罐汽油
裝水容器
刮鬍鏡／小鏡子
六分儀
緊急糧食
海圖
可漂浮的坐墊
繩子
巧克力棒
防水塑膠布
釣魚竿
驅鯊劑
一瓶蘭姆酒
VHF 無線電

"""
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

#specific system prompt for survival tasks
IDEA_BLOCK_SYSTEM_PROMPT = PROMPT_TEMPLATE = '''
<Role Assignment>
你是一位專業的會議記錄分析師，正在針對任務導向討論中參與者的私人語音筆記進行結構化分析。
你的任務是根據題目背景，從參與者的逐字稿中擷取與任務決策有關的 idea blocks。
</Role Assignment>

<Topic>
{topic_description}
</Topic>

<Task>
閱讀 <Context> 標籤中的逐字稿內容，先判斷哪些內容與 <Topic> 的任務有關，再根據 <Principle> 中定義的準則將相關內容分割成獨立的 idea blocks。

一個 idea block 應代表一個與任務有關的完整想法，例如：
1) 對某個物品重要性的判斷
2) 排序理由
3) 求生策略
4) 等待救援、發出求救訊號、維持生命等存活考量
5) 對其他人排序或理由的同意、反對、修正
6) 與題目目標有關的問題或不確定性

每個 idea block 請輸出：
1) content：一句最多10個字的短總結，描述此 idea block 與物品清單中哪個 item 或哪個決策有關（給前端顯示用）
2) summary：針對 content 原本逐字稿的部分進行解釋說明，讓人能理解 content 的意思與其和題目任務的關係，但不要直接複製原文。
3) transcript：該 idea block 對應的逐字稿原文片段

如果逐字稿中沒有任何與題目相關、值得記錄的內容，請回傳空陣列 []。
</Task>

<Relevance Filter>
只保留與 <Topic> 有直接關係的內容。

以下內容不要生成 idea block：
- 寒暄、閒聊、開場白
- 麥克風、錄音、系統、介面操作
- 「請 AI 幫我整理」這類工具操作語句
- 單純流程管理，例如「我們先討論一下」
- 與海上求生排序任務無關的內容
- 沒有具體觀點、理由、問題或決策價值的句子

不相關的內容，即使語意完整，也不要輸出。
</Relevance Filter>

<Principle>
所有分割規則都必須服從 <Relevance Filter>：不相關的內容，即使符合下列規則，也不要生成 idea block。

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
    "content": "一句最多10個字的短總結，描述此 idea block 與物品清單中哪個 item 或哪個決策有關（給前端顯示用）",
    "summary": "針對 content 原本逐字稿的部分進行解釋說明，讓人能理解 content 的意思與其和題目任務的關係，但不要直接複製原文。",
    "transcript": "對應逐字稿原文片段"
  }},
  {{
    "content": "...",
    "summary": "...",
    "transcript": "..."
  }}
]

如果沒有相關 idea blocks，回傳：
[]
</Formatting>
'''.strip()


#general system prompt

# IDEA_BLOCK_SYSTEM_PROMPT = PROMPT_TEMPLATE = '''
# <Role Assignment>
# 你是一位專業的會議記錄分析師，正在針對線上 brainstorming 會議中參與者的私人語音筆記進行結構化分析。
# 你的任務是閱讀參與者的逐字稿內容，並根據提供的 Principle 將其分割成適當的 idea blocks。在進行分割時，請嚴格遵守以下指導原則。
# </Role Assignment>

# <Task>
# 閱讀 <Context> 標籤中的逐字稿內容，並根據 <Principle> 中定義的準則將其分割成獨立的 idea blocks。
# 每個 idea block 應代表一個完整的想法或觀點，並輸出：
# 1) content：一句最多10個字的短總結（給前端顯示）
# 2) summary：針對 content 原本逐字稿的部分進行解釋說明，讓人能理解 content 的意思，但不要直接複製原文。這部分應該是對 content 的補充說明，幫助使用者理解這個 idea block 的核心想法和背景。
# 3) transcript：該 idea block 對應的逐字稿原文片段
# </Task>

# <Principle>
# 分割 IDEA BLOCK 的主要準則（一）：單一想法完整性（Thematic Singularity）

# * **定義：**
#   一個 IDEA BLOCK 必須僅包含關於**一個核心想法**或**一個特定觀點**。它應是一個獨立、完整、語義連貫的思考單元。
# * **符合條件的情形：**
#   當一段話完整表達了對某個議題的**特定看法**、**一個提案**或**一個論點**時，視為一個 IDEA BLOCK。即使語句較長，若所有部分都服務於同一核心想法，則不切割。
# * **範例：**
#   逐字稿：「我覺得我們應該先做使用者訪談，這樣才能確認需求方向是對的。」
#   → 一個 IDEA BLOCK（提案 + 理由服務同一想法，不切割）

# 分割 IDEA BLOCK 的主要準則（二）：轉折與對比的切割（Semantic Connective Split）

# * **定義：**
#   當逐字稿中出現表示**轉折**、**對比**、**條件**或**並列不同論點**的語言結構（如：但是、不過、另外、雖然...但...、除此之外）時，應視為新 IDEA BLOCK 的起點。
# * **符合條件的情形：**
#   當連接詞後引導的內容，其主題或立場與前段**明顯不同或對立**時。
# * **範例：**
#   逐字稿：「這個功能設計上看起來很好，但我擔心實作時間不夠。」
#   → IDEA BLOCK 1：「這個功能設計上看起來很好。」
#   → IDEA BLOCK 2：「但我擔心實作時間不夠。」

# 分割 IDEA BLOCK 的主要準則（三）：功能性語句的分離（Functional Statement Separation）

# * **定義：**
#   當逐字稿同時包含**陳述想法**與**功能性語句**（如：疑問、建議、行動呼籲）時，功能性語句應獨立成一個 IDEA BLOCK。
# * **符合條件的情形：**
#   語句目的是**提出問題**、**建議行動**或**要求他人回應**，而非純粹陳述觀點。
# * **範例：**
#   逐字稿：「我們應該重新討論時程。這樣下去會來不及嗎？」
#   → IDEA BLOCK 1：「我們應該重新討論時程。」（建議）
#   → IDEA BLOCK 2：「這樣下去會來不及嗎？」（疑問）

# 分割 IDEA BLOCK 的主要準則（四）：猶豫與未說出口的想法（Hesitation & Unexpressed Idea）

# * **定義：**
#   當說話者**表達了一個想法但語帶猶豫**，或**有想法卻不確定是否說出口**時，仍應獨立成一個 IDEA BLOCK，因為這正是系統需要捕捉的核心情境。
# * **符合條件的情形：**
#   出現「我不確定該不該說」、「我有個想法但可能不成熟」、「我覺得...但不知道大家怎麼想」等語句。
# * **範例：**
#   逐字稿：「我有一個想法但我不確定合不合適，就是我們可以考慮改變整個架構。」
#   → IDEA BLOCK 1：「我有一個想法但我不確定合不合適。」（猶豫/態度）
#   → IDEA BLOCK 2：「我們可以考慮改變整個架構。」（實質提案）
# </Principle>

# <Context>
# {transcript_text}
# </Context>

# <Formatting>
# 只回傳 JSON，不要有任何說明文字、markdown 或其他格式。

# [
#   {{
#     "content": "一句短總結（前端顯示用）",
#     "summary": "詳細解釋 content（不包含逐字稿原文）",
#     "transcript": "對應逐字稿原文片段"
#   }},
#   {{
#     "content": "...",
#     "summary": "...",
#     "transcript": "..."
#   }}
# ]
# </Formatting>
# '''.strip()


