# OmniObserve 前導使用者研究 Protocol v1

## 1. 研究概述

### 1.1 Motivation and Research Gap

小組腦力激盪與小組決策常被用在課堂與工作場域，但實際效果經常受到隱性的群體動態限制。參與者可能因為不確定、怕打斷、擔心被評價、或覺得自己是少數意見，而沒有說出懷疑、不同意見或尚未成熟的新想法。因此，討論中最有價值的洞察不一定會出現在公開發言或文字訊息中 [cite]。

現有 AI facilitator 多半依賴已經被說出或打出的內容，例如 group chat、即時逐字稿或會議摘要。這類系統可以整理 public discourse，卻難以處理仍停留在參與者心中的 unspoken thoughts。換句話說，若最重要的想法沒有被說出口，僅分析公開討論的 AI facilitator 就無法看見它們。

本研究的核心問題是：如果最好的想法仍然保持沉默，AI facilitator 能否在不破壞討論流暢度與參與者自主性的前提下，幫助這些想法浮現？

### 1.2 Our Approach: Front-Back Channel Framework

OmniObserve 採用 front-back channel framework，將公開討論與個人私下思考連接起來。

- **Front channel**：公開小組討論，包含 public voice、group chat、public transcript 與共同排序。
- **Back channel**：參與者個人的 private thoughts，包含快速語音、文字輸入、疑問、不同意見、尚未成熟的想法與排序理由。
- **AI facilitation layer**：系統在不公開 private content 的情況下，偵測 private thoughts 之間、以及 private thoughts 與 public discourse 之間的 alignment 或 mismatch。

系統設計不是自動替參與者發言，而是支援三個轉換步驟：

1. **Capture private signals**：用低負擔方式記錄私下的懷疑、不同意見與補充理由。
2. **Connect shared unspoken thoughts**：當多位參與者有相似但尚未公開的想法時，系統辨識 shared unspoken alignment。
3. **Scaffold transition into public discussion**：系統以 cue 提醒參與者「你可能不是唯一這樣想的人」，但是否提出、何時提出、如何提出仍由參與者決定。

本前導研究使用 Lost at Sea 小組排序任務，因為它會自然產生不同判斷、少數意見、信心差異與排序理由衝突。雖然任務不是開放式創意發想，但它能提供可觀察的 private-to-public transition 場景：參與者可能私下保留某個理由，卻在公開討論中因群體壓力、時間或不確定性而沒有提出。

### 1.3 Design Considerations

| ID | 設計考量 | 對應到 OmniObserve 的設計 |
| --- | --- | --- |
| D1 | Reduce cognitive load：backchannel 不應與主討論競爭注意力。 | 系統支援 lightweight private input，例如 quick voice 或簡短文字，讓參與者能快速留下疑問與理由；cue 優先指出 private-public mismatch 或 shared unspoken thoughts，而不是要求參與者長篇輸入。 |
| D2 | Minimize disruption：避免打斷主要討論流程。 | 系統只在偵測到 shared unspoken alignment 或明顯 private-public mismatch 時提示，避免把每個 private thought 都變成干擾。cue 應短、少、可忽略。 |
| D3 | Preserve agency：參與者決定是否與何時分享。 | 系統不自動公開 private thoughts，也不揭露他人 private reasoning；cue 只提供社會支持與時機線索，公開發言的內容與時機由參與者控制。 |

### 1.4 Key Hypotheses

本研究以 hypotheses 取代開放式 RQs，並把觀察、訪談與 log 指標對應到每個假設。

| Hypothesis | 研究假設 | 主要證據 |
| --- | --- | --- |
| H1 | Awareness of shared unspoken thoughts increases confidence in expressing disagreement. | cue 後的 disagreement 發言、訪談中對信心提升的描述、private disagreement 是否轉為 public disagreement。 |
| H2 | Early signals of shared support for unspoken ideas lead to higher-quality contributions. | cue 後貢獻是否包含理由、證據、替代方案或整合他人觀點；小組排序或討論品質是否改善。 |
| H3 | Participants are more receptive to interruptions when surfaced ideas demonstrate prior alignment. | 參與者是否接受 cue timing、是否覺得 cue 是有根據的提醒而非干擾、cue 後是否出現 constructive uptake。 |
| H4 | Control over if and when to share increases participants' willingness to externalize ideas in the private channel. | private input 使用量、private thoughts 的具體程度、訪談中對隱私與控制感的描述。 |

本研究不只比較最後小組答案是否更接近標準答案。由於這是小規模 pilot，主要證據會來自系統紀錄、現場觀察筆記，以及事後訪談中對 private-to-public 想法轉移過程的描述。

### 1.5 實驗條件

本研究採 between-subjects pilot design，共兩組，每組三位討論者。若使用暗樁，暗樁應取代其中一位討論者，而不是額外加入第四人；這樣才能維持三人小組討論結構一致。

| 組別 | 條件 | 說明 |
| --- | --- | --- |
| 對照組 | Front channel + private capture only | 參與者使用平台進行個人思考與公開討論，系統保留 private input 紀錄，但不顯示 shared unspoken thought cue。 |
| 實驗組 | Front-back channel cue | 小組討論階段中，系統根據 private thoughts、public discourse 與參與者間 alignment，在適當時機顯示 cue，協助 shared unspoken thoughts 轉入公開討論。 |

對照組應盡量保留相同的任務、公開討論、排序介面、公開逐字稿、private input 與 group chat。差異應集中在核心介入功能，也就是系統是否把 backchannel alignment 轉化為 public-discussion cue。

### 1.6 參與者

每組包含三位討論者。理想條件如下：

- 參與者不知道 Lost at Sea 任務的標準答案。
- 參與者不是 OmniObserve 開發團隊成員。
- 參與者不知道本研究真正關注 shared unspoken thoughts 對發言行為的影響。
- 若可行，三位參與者不應是非常熟悉的固定討論夥伴。
- 若使用暗樁，其他參與者在任務進行時不應知道暗樁身分，但研究結束後必須在 debrief 中說明。

### 1.7 實驗場地

三位討論者分別被帶到三間不同教室或討論室。他們只透過 OmniObserve 進行溝通。若其中一位是暗樁，仍使用相同房間與系統設定。

這樣安排的原因：

- 模擬線上會議情境。
- 避免面對面眼神、肢體語言或現場氣氛主導討論。
- 保護每位參與者的 private board 與 private mic，不被其他參與者直接看到。
- 讓觀察者能記錄操作問題與關鍵事件，而不打斷任務。

每間教室應準備：

- 一台筆電或桌機。
- 穩定網路。
- 麥克風與喇叭，或耳機麥克風。
- OmniObserve session link。
- Participant ID，例如 P1、P2、P3。
- 任務說明。
- 研究者觀察筆記表。

## 2. 實驗材料

參與者抵達前，請準備：

- 每位參與者的 OmniObserve session link。
- Admin 頁面，用於切換 phase、計時、控制 cue 條件與監控狀態。
- Lost at Sea 任務說明。
- 同意書或口頭同意 script。
- 參與者任務說明。
- 觀察筆記表。
- 事後訪談題綱。
- 訪談錄音設備。
- 研究團隊內部備用通訊管道。
- 系統失效備案，例如截圖、研究者端畫面錄製或手動紀錄。

## 3. 招募信

主旨：邀請參與線上協作討論系統使用者研究

您好，

我們是顏羽君教授 HAIX Lab 的研究團隊，正在進行一項關於線上協作討論系統的使用者研究，想邀請您參與一次約 60 到 90 分鐘的實驗。

在研究中，您會和另外幾位參與者一起完成一個小組決策任務。流程包含個人思考、小組線上討論，以及實驗後的簡短訪談。過程中我們會記錄系統操作資料、討論內容與訪談錄音。資料只會用於學術研究分析，並會以匿名方式整理。

參與條件：

1. 能使用電腦與麥克風進行線上討論。
2. 願意在實驗中進行個人思考與小組討論。
3. 實驗前請不要搜尋或查詢任務相關答案。

實驗長度：約 60 到 90 分鐘  
研究團隊：顏羽君教授 HAIX Lab 研究團隊

若您願意參與，請回覆確認，我們將另行提供實驗時間、地點及系統連結。謝謝！

## 4. 實驗流程時間表

建議總時長抓 70 到 80 分鐘。若時間不足，優先縮短訪談長度，不建議完全刪除訪談。

| 時間 | 階段 | 內容 |
| ---: | --- | --- |
| 0-5 分鐘 | 報到與同意 | 歡迎參與者，說明錄音、資料使用方式，提醒不可查答案。 |
| 5-10 分鐘 | 帶位與設備檢查 | 將參與者帶到不同教室，檢查瀏覽器、麥克風、聲音與 participant ID。 |
| 10-15 分鐘 | 介面熟悉 | 說明公開麥克風、個人想法記錄、排序介面、公開逐字稿、private ideas 與 group chat。 |
| 15-20 分鐘 | 練習任務 | 用與正式任務無關的小題目練習 private input 與 public speaking。 |
| 20-25 分鐘 | 正式任務說明 | 介紹 Lost at Sea 與小組最終排序目標。 |
| 25-30 分鐘 | 第一階段：個人思考 | 參與者獨立排序，並透過 private input 說明理由。 |
| 30-45 分鐘 | 第二階段：小組討論 | 參與者進行 15 分鐘討論，形成一份小組共同排序。 |
| 45-50 分鐘 | 最終答案 | 參與者提交或確認小組最終排序。 |
| 50-70 分鐘 | 事後訪談 | 針對每位參與者進行個別訪談，搭配 observer notes 追問關鍵事件。 |
| 70-80 分鐘 | Debrief | 說明研究目的、實驗條件、cue 機制，若使用暗樁則說明暗樁安排。 |

## 5. 研究者角色分工

| 角色 | 工作 |
| --- | --- |
| 主持人 | 開場說明、規則說明、控時、帶領 debrief。 |
| Admin | 切換 phase、監控 session 狀態、控制 cue 條件、確認 logs。 |
| P1 觀察者 | 觀察 P1 的操作與反應，記錄 critical incidents。 |
| P2 觀察者 | 觀察 P2 的操作與反應，記錄 critical incidents。 |
| P3 觀察者 | 觀察 P3 的操作與反應，記錄 critical incidents。 |
| 暗樁，可選 | 假裝成一般參與者，在適當時機提出具說服力但錯誤的論點。 |

若人手不足，Admin 可兼任其中一位 participant observer。主持人不建議兼太多觀察工作，避免漏掉流程控制。

## 6. 開場說明

各參與者抵達後即直接前往各自指定教室，由負責該教室的研究者個別朗讀。

> 你好，謝謝你今天來參與我們的使用者研究。
>
> 今天的研究會請你們使用一個線上協作討論系統，和其他參與者一起完成一個小組決策任務。整個流程包含三個部分：第一，個人思考；第二，小組討論；第三，簡短訪談。
>
> 研究過程中，我們會記錄系統中的操作資料、討論內容與訪談錄音。這些資料只會用於研究分析，之後整理時會匿名處理，不會把你的名字和具體發言直接對外公開。
>
> 你可以在任何時間停止參與，也可以選擇不回答任何訪談問題。
>
> 在實驗過程中，請不要使用 Google、ChatGPT、搜尋引擎或其他外部資料查詢任務答案，因為我們想觀察的是你們如何根據自己的判斷進行討論。

## 7. 個別房間說明

> 今天每位參與者都會在自己的教室裡進行實驗，你們會透過系統中的語音和文字功能和其他參與者討論。
>
> 這樣安排的原因是，我們想模擬線上討論情境，讓大家主要透過系統進行互動，而不是依靠現場眼神或肢體動作。
>
> 我會在這裡協助你設備設定，也會觀察你和系統互動的情況，方便之後訪談時詢問你的使用經驗。我不會把你的個人想法直接分享給其他參與者。

## 8. 介面熟悉流程

### 8.1 說明稿

> 現在請看你的畫面。你會看到任務區、討論區，以及你自己的個人想法區。
>
> 等一下你會用到兩種主要功能。
>
> 第一個是公開發言。當你使用公開麥克風時，其他參與者會聽到你說的話，這些內容也會成為小組討論的一部分。
>
> 第二個是個人想法記錄。這個功能是給你自己整理想法用的，其他參與者不會直接看到你在這裡說了什麼或寫了什麼。
>
> 請特別注意畫面上的麥克風狀態。如果你要公開講話，請確認目前是公開狀態；如果你只是想記錄自己的想法，請確認目前是在個人想法記錄狀態。
>
> 你也可以透過文字輸入記錄想法，或在公開聊天室中發言。

### 8.2 研究者確認清單

正式任務開始前，確認每位參與者可以：

- 辨認自己的 participant ID。
- 看到排序任務區。
- 理解公開麥克風如何使用。
- 理解個人想法記錄如何使用。
- 理解手動輸入 private idea 如何使用。
- 理解 group chat 如何使用。
- 辨認目前哪一種麥克風狀態是啟用的。
- 拖曳或更新排序物品。

## 9. 介面操作引導

介面本身即載入正式任務內容（Lost at Sea），無單獨練習題目。研究者逐一帶領參與者操作各功能區塊，確認熟悉後再進入正式流程。

引導順序建議：

1. **任務區**：請參與者閱讀畫面上的任務說明與物品清單，確認看得到所有內容。
2. **個人想法記錄（private）**：請參與者試著用個人想法記錄功能，輸入任意一句話或說出任意想法，確認理解這是私人的、不會被其他人看到。
3. **公開麥克風（public mic）**：請參與者確認麥克風狀態指示，試著切換並說一句話，確認理解公開發言會被其他參與者聽到。
4. **公開聊天室（group chat）**：請參與者試著用文字在公開聊天室發一則訊息，確認看得到輸入欄位。
5. **排序介面**：請參與者試著拖曳或更新一個物品的順序，確認操作得了排序功能。

操作引導結束後，研究者說：

> 好，你已經知道每個區塊怎麼用了。接下來我會說明今天的正式任務內容。

## 10. 正式任務說明：Lost at Sea

### 10.1 說明稿

> 接下來的任務叫做 Lost at Sea。
>
> 請想像你們是一組在海上遇難的人。你們現在有一批物品，但無法全部同等重視，因此需要判斷哪些物品對生存和獲救最重要。
>
> 你們會先各自思考 5 分鐘，產生自己的排序與理由。這個階段請不要和其他人討論。
>
> 接著你們會進入 15 分鐘的小組討論。你們需要一起討論並產生一份小組最終排序。
>
> 請注意，過程中不要上網查答案，也不要使用任何外部工具搜尋這個任務。這個任務的重點不是考你是否知道標準答案，而是觀察你們如何討論、表達理由、形成共識。

### 10.2 參與者任務規則

- 不可搜尋網路。
- 不可詢問 ChatGPT 或其他外部工具。
- 先獨立完成自己的排序。
- 小組討論階段需要產生一份共同排序。
- 可以提出不同意見、修改排序或說明不確定的地方。
- 小組不需要達成完全一致，但最後必須提交一份排序。

## 11. 第一階段：個人思考

時間：5 分鐘。

### 11.1 參與者說明

> 現在請你自己思考 5 分鐘。
>
> 請先不要和其他人討論。
>
> 你需要完成兩件事：第一，排出你自己的物品順序；第二，盡量用個人想法記錄功能說出或寫下你的理由。
>
> 你不需要把理由講得很完整，可以是直覺、疑問、反對某個物品的理由，或你覺得某個物品重要的原因。這些內容主要是幫助你自己在等一下的小組討論中回想。

### 11.2 需記錄資料

- 個人初始排序。
- Private transcripts。
- 手動輸入的 private ideas。
- 系統產生的 idea blocks。
- 每個 idea block 對應到的 task item。
- 若後端在 private phase 計算 similarity pairs，也需記錄。
- 排序移動紀錄。
- 麥克風狀態與輸入行為。

重要：即使系統在背景計算 similarity 或 shared unspoken alignment，個人思考階段也不應顯示 cue。

## 12. 第二階段：小組討論

時間：15 分鐘。

### 12.1 對照組說明稿

> 現在請你們開始小組討論。
>
> 你們有 15 分鐘，需要在時間內產生一份小組共同排序。
>
> 你們可以自由討論、提出理由、反對或修改排序。最後請提交一份小組最終答案。

### 12.2 實驗組說明稿

> 現在請你們開始小組討論。
>
> 你們有 15 分鐘，需要在時間內產生一份小組共同排序。
>
> 系統有時候可能會根據你先前記錄的想法，提醒你有些內容可能和目前討論有關，或可能也有其他人有相近想法。你可以自行決定是否採納、忽略，或把它帶入討論。系統不會自動替你公開你的個人想法，也不會公開其他人的個人想法。

### 12.3 建議提示文字

可使用以下其中一種提示：

> 你不是唯一對「{item}」有這個方向想法的人。若你覺得合適，可以把你的觀點帶入討論。

> 你先前提到的「{idea_summary}」和目前討論可能有落差。若你想補充，可以選擇現在或稍後提出。

> 目前有不只一個人私下提到與「{item}」相關的疑問或支持理由。你可以決定是否提出自己的版本。

Cue 的角色應該是提供 shared unspoken alignment 的 awareness，而不是直接公開他人的 private reasoning。系統連結的基礎是 conclusion alignment、decision-level alignment 或 private-public mismatch，不必要求兩人的理由完全相同。Cue 應避免頻繁出現；若只有單一 private thought 且沒有 alignment 或 mismatch，原則上不提示。

### 12.4 若使用暗樁

暗樁應該：

- 假裝成一般參與者。
- 使用事先準備好的講稿。
- 提出強勢、合理但錯誤的論點。
- 避免使用明顯荒謬的理由。
- 避免強勢到其他真實參與者無法發言。
- 製造讓其他參與者可能私下不同意、但需要信心與時機才會公開反駁的情境。
- 在對方提出不同意見後保留討論空間，讓研究團隊能觀察 disagreement 如何被接住。

研究結束後必須在 debrief 中說明暗樁安排，並讓參與者有機會撤回資料。

## 13. 討論結束

### 13.1 說明稿

> 時間到，小組討論到此結束。

研究者直接截取/記錄當下介面上的小組排序狀態，無需參與者另行提交。

### 13.2 需記錄資料

- 小組最終排序。
- 每位個人排序與小組排序的差異。
- 小組排序與標準答案的差異。
- 公開逐字稿。
- Public chat messages。
- 實驗組中出現的 cue、cue 時間、cue 接收者與連結的 idea blocks。
- Cue 出現後，對應想法是否進入公開討論。
- Cue 出現後，公開討論是否接納、忽略或抵抗該想法。
- Private thoughts 是否包含 doubts、disagreements、novel ideas、support signals。
- Shared unspoken thoughts 被偵測到後，是否轉化為公開貢獻。

## 14. 觀察筆記

三位研究者各自在不同教室，每人使用一份單人觀察記錄表記錄自己房間的 critical incidents。不需要完整逐字記錄，重點是記錄之後可以拿來訪談追問的具體事件。實驗期間可參考 cheatsheet，實際紀錄填在記錄表。

**觀察 cheatsheet 詳見**：[`observation-cheatsheet.zh.md`](./observation-cheatsheet.zh.md)

**單人觀察記錄表詳見**：[`observation-notion-template.zh.md`](./observation-notion-template.zh.md)

記錄表包含：
- 單一受試者的 session 基本資訊。
- 實驗期間各階段需要記錄的欄位。
- Critical incident 快速記錄表。
- 半結構式訪談記錄欄位與 critical incident 追問欄位。

## 15. 事後訪談

訪談由負責該參與者所在教室的研究者個別進行，每位參與者約 8 到 12 分鐘。

**訪談 cheatsheet 詳見**：[`observation-cheatsheet.zh.md`](./observation-cheatsheet.zh.md) — 「Page 2. 半結構式訪談問什麼」段落

**訪談記錄表詳見**：[`observation-notion-template.zh.md`](./observation-notion-template.zh.md) — 「Page 2. 半結構式訪談記錄」段落

訪談記錄表包含以下區塊：

| 區塊 | 內容 | 備註 |
| --- | --- | --- |
| 暖身問題 | 整體經驗、表達難易度 | 三組同問 |
| 個人思考階段 | 排序决策、private 功能使用 | 三組同問 |
| Private-to-Public 轉換 | 未發言原因、發言觸發因素 | 三組同問 |
| Cue 相關問題 | 注意到 cue、理解、影響 | 僅實驗組 |
| 對照組問題 | 自判發言時機、對 cue 的想像 | 僅對照組 |
| Critical Incident 追問 | 根據觀察者記錄的具體事件追問 | 三組同 |

> **提醒**：不要一開始就說本研究在測試 cue 是否讓參與者更願意發言。先問整體經驗，再追問具體事件。

## 16. Debrief 說明

### 16.1 一般 Debrief

> 謝謝你完成今天的研究。
>
> 我們這次研究主要想了解，在小組討論中，系統是否能幫助參與者把個人階段想到、但可能沒有說出來的想法帶入公開討論。特別是當不只一個人私下有相近的疑問、支持或不同意見時，系統能否提供適當提醒，讓參與者更有信心決定是否提出。
>
> 有些組別會看到系統提示，有些組別不會。這是我們研究設計的一部分，用來比較提示是否影響討論行為。
>
> 系統不會自動公開你的個人想法，也不會把你的 private reasoning 直接給其他人看。提示的目的是提供可能的 shared alignment 或討論時機，但是否提出、何時提出、怎麼提出仍由你自己決定。
>
> 你的資料會匿名處理，只用於研究分析。

### 16.2 若使用暗樁，需追加說明

> 另外，今天討論中有一位參與者是研究團隊安排的成員。他的任務是在討論中提出某些具有說服力、但不一定正確的觀點。
>
> 這是為了觀察當小組中出現較強勢的意見時，其他參與者是否會先在 private channel 留下不同想法，以及系統提示是否能幫助 shared unspoken disagreement 被帶入公開討論。
>
> 我們不會用這個設計評價你的能力或表現，而是分析系統與討論過程。
>
> 如果你對這個安排感到不舒服，可以告訴我們，我們可以刪除你的資料。

## 17. 評估指標

### 17.0 Hypothesis-to-measure Mapping

| Hypothesis | 需要觀察的現象 | 對應資料 |
| --- | --- | --- |
| H1 confidence in disagreement | 參與者在知道有人有相近未公開想法後，是否更敢提出不同意見。 | cue 後 disagreement 發言、訪談中的信心描述、private disagreement 到 public disagreement 的轉換。 |
| H2 quality of contribution | cue 是否讓早期 private support 轉成更有品質的公開貢獻。 | 發言內容是否包含理由、證據、比較、整合或新的替代方案；final ranking improvement 作為輔助資料。 |
| H3 interruption receptivity | 參與者是否把 cue 視為有根據的提醒，而不是干擾。 | cue noticed、cue ignored、cue perceived as helpful/disruptive、cue 後討論是否接住該想法。 |
| H4 willingness to externalize privately | 保有控制權是否讓參與者更願意在 private channel 留下想法。 | private input 數量、長度、類型、具體程度，以及對隱私與控制感的訪談描述。 |

### 17.1 量化指標

| 指標 | 計算方式 |
| --- | --- |
| 個人分數 | 每個物品的個人排序與標準答案排名差距加總，越低越好。 |
| 小組分數 | 小組最終排序與標準答案排名差距加總，越低越好。 |
| 個人到小組改善幅度 | 個人平均分數減去小組分數。 |
| Private-to-public conversion rate | 後來進入公開討論的 private ideas 數量除以所有 private ideas 數量。 |
| Shared unspoken conversion rate | 被系統判定為 shared unspoken alignment 的 private ideas 中，後來進入公開討論的比例。 |
| Cue uptake rate | Cue 出現後有對應公開貢獻的 cue 數量除以所有 cue 數量。 |
| Ignored cue rate | Cue 出現後沒有對應公開貢獻的 cue 數量除以所有 cue 數量。 |
| Disagreement expression rate | Private disagreement 後來被公開提出的比例，或每位參與者公開 disagreement 的次數。 |
| Private externalization rate | 每位參與者在 private channel 留下的 ideas 數量、平均長度與任務物品覆蓋數。 |
| Cue receptivity rating | 訪談或問卷中對 cue 是否有幫助、是否干擾、是否時機合適的評分。 |
| Contribution quality score | 研究者事後編碼公開貢獻品質，例如是否包含理由、比較、證據、整合或新觀點。 |
| Speaking turns | 每位參與者公開發言次數。 |
| Speaking duration | 若可取得，每位參與者公開發言總時長。 |
| Ranking change count | 每位參與者與小組的排序移動次數。 |
| Private-public mismatch cases | Private ranking 或 private idea 與 public discussion/group ranking 差距超過門檻的次數，例如差距超過 2 名。 |

### 17.2 質化編碼

| Code | 說明 |
| --- | --- |
| private idea surfaced | Private 階段想法後來被公開提出。 |
| private idea suppressed | Private 階段想法沒有被公開提出。 |
| cue noticed | 參與者注意到 cue。 |
| cue ignored | 參與者注意到 cue，但沒有行動。 |
| cue prompted speaking | 參與者表示 cue 促成或影響其發言。 |
| shared unspoken alignment | 兩位以上參與者在 private channel 中表達相近但尚未公開的想法。 |
| private-public mismatch | 參與者 private thought 與公開討論方向或小組排序出現明顯落差。 |
| disagreement expressed | 參與者公開提出不同意見、反駁或保留意見。 |
| disagreement withheld | 參與者 private channel 中有不同意見，但公開討論中沒有提出。 |
| contribution elaborated | 參與者公開發言包含理由、比較、證據、假設或整合他人觀點。 |
| interruption accepted | 參與者認為 cue 的出現時機合理，或公開討論接住 cue 促成的想法。 |
| interruption resisted | 參與者認為 cue 干擾討論，或 cue 促成的想法被公開討論忽略/排斥。 |
| uncertainty | 參與者不確定自己的想法是否正確或值得說。 |
| timing barrier | 參與者不知道何時插話或進入討論。 |
| social pressure | 參與者因主導意見或群體共識壓力而不發言。 |
| system confusion | 參與者誤解 mic state、cue 意義或介面控制。 |
| privacy concern | 參與者擔心 private thoughts 被其他人看到。 |

## 18. 資料收集清單

實驗前：

- [ ] Participant IDs 已分配。
- [ ] Session links 已產生。
- [ ] Cue 條件設定正確。
- [ ] Admin page 已準備。
- [ ] 麥克風與聲音已測試。
- [ ] 任務說明已準備。
- [ ] 觀察表已準備。
- [ ] 訪談錄音設備已準備。

實驗中：

- [ ] 已完成同意流程。
- [ ] 已提醒參與者不可搜尋答案。
- [ ] 已完成練習任務。
- [ ] 已記錄個人排序。
- [ ] 已記錄 private transcripts 與 idea blocks。
- [ ] 已記錄 group discussion transcript。
- [ ] 實驗組已記錄 cue logs。
- [ ] 已標記 shared unspoken alignment 與 private-public mismatch cases。
- [ ] 已記錄小組最終排序。
- [ ] 觀察者已寫下帶時間戳的事件筆記。

實驗後：

- [ ] 已完成個別訪談錄音。
- [ ] 已完成 debrief。
- [ ] 若使用暗樁，已揭露暗樁安排。
- [ ] 已讓參與者有機會在 debrief 後撤回資料。
- [ ] Logs 已匯出或備份。
- [ ] 研究者趁記憶新鮮寫下簡短 memo。

## 19. 風險與緩解

### 19.1 隱私

參與者可能擔心 private thoughts 被其他人看到。研究者應清楚說明：private thoughts 不會直接分享給其他參與者。觀察者可能會為了研究目的看到互動行為，但不會把 private content 分享給其他參與者。

### 19.2 麥克風狀態混淆

公開麥克風狀態必須清楚。正式任務開始前，參與者必須理解 public mic 與 private thought recording 的差異。

### 19.3 任務答案外洩

Lost at Sea 有標準答案，因此必須提醒參與者不可搜尋網路或使用外部工具。若參與者表示自己知道或查過答案，需記錄並考慮將該場次排除於分數分析之外。

### 19.4 過度提醒 cue

任務前不應過度說明 shared unspoken thought cue。若參與者一直盯著 cue，討論會變得不自然。實驗組只需要知道系統有時會顯示相關提醒，而且是否採納由自己決定。

### 19.5 暗樁與欺瞞

若使用暗樁，研究團隊必須在 debrief 中說明，並允許參與者撤回資料。暗樁不應讓參與者覺得自己被評價、被嘲弄或被針對。

## 20. 實驗當天快速流程

1. 歡迎參與者並完成同意流程。
2. 提醒參與者不可搜尋答案。
3. 將參與者帶到不同教室。
4. 檢查 participant ID、麥克風、聲音與系統連結。
5. 說明公開麥克風、個人想法記錄、排序、逐字稿與聊天室。
6. 進行短練習任務。
7. 介紹 Lost at Sea。
8. 開始 5 分鐘個人思考階段。
9. 儲存或確認個人排序。
10. 開始 15 分鐘小組討論階段。
11. 實驗組只在小組討論階段啟用 shared unspoken thought cue。
12. 提交小組最終排序。
13. 根據觀察筆記進行個別訪談。
14. Debrief 參與者。
15. 匯出 logs 並撰寫研究者 memo。
