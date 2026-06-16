# 主持人 Admin Observer Checklists

本文件是正式實驗當天用的操作清單。每場實驗 4 人一組，其中 3 位真實參與者、1 位暗樁。Host 同時擔任 Admin；三位 Observer 各負責一位真實參與者的觀察與 Debrief 前個別訪談。

## 1. 場次資訊

| 欄位 | 填寫 |
| --- | --- |
| Group ID |  |
| 日期 |  |
| 地點 / Google Meet |  |
| Host / Admin |  |
| Observer 1 / Participant |  |
| Observer 2 / Participant |  |
| Observer 3 / Participant |  |
| Confederate ID |  |
| Task order | Lost -> Poster / Poster -> Lost |
| Lost condition | no cue / with cue |
| Poster condition | no cue / with cue |
| 系統版本 / commit |  |
| Canva material version |  |
| Poster reviewer feedback available | yes / no / unsure |
| Individual Google Meet recording files |  |
| 第二螢幕配置 | 會議室大電視 / 研究團隊自備螢幕 / 其他： |
| Participant mapping table |  |
| Task 1 system links |  |
| Task 2 system links |  |
| Individual Meet links |  |
| Group familiarity level | none / low / medium / high / mixed / unknown |
| Familiarity recruitment decision | less_familiar_target / acceptable_covariate / over_familiar_use_with_caveat / exclude_or_reschedule / PI_decision_needed |

## 2. Host / Admin 場前檢查

### 2.1 Run-of-show Preflight（正式流程開始前完成）

此清單只供 Host/Admin/Observer 使用，不寄給受試者，不放在受試者可見畫面。cue/no-cue 條件、暗樁安排、mapping table 與 staff fallback room 都是 staff-only 資訊。

Link、permission、staff-only room、condition assignment、hidden setup 與 export readiness 應在參與者進場前完成。Device / Audio / Recording 與 participant screen-share 類檢查需在參與者加入各自個別 Meet 後、正式開場前完成；不得為了勾選場前清單而提前標記尚未實測的錄影、畫面或收音狀態。

#### Link / Permission / Communication

- [ ] 已把正式集合時間、地點、攜帶設備與注意事項用 email 寄給所有參與者；不要只依賴現場口頭或即時訊息分享。
- [ ] 每位參與者的 Task 1 OmniObserve link 已產生、測試可開啟，且只包含該 participant system id。
- [ ] 每位參與者的 Task 2 OmniObserve link 已產生、測試可開啟，且在 Task 1 前不提供給參與者操作。
- [ ] 每位真實參與者的個別 Google Meet link 已建立，Observer 知道自己負責哪一間。
- [ ] Staff-only fallback room（例如 `meet.omni.elvismao.com` 或團隊指定會議室）已建立，用於 Host/Observer 旁聽與協調，不進入參與者的 OmniObserve participant room。
- [ ] 教學影片、Debrief 影片、Google Forms、小表單 A/B、大表單、Canva、圖床與 task materials 的權限已用非擁有者帳號測試。
- [ ] 參與者可見的 link/email 沒有透露 task order、cue/no-cue 條件、暗樁安排、研究假設或 staff-only room。
- [ ] Slack/Line/Email fallback channel 已指定；若正式 link 失效，由 Host 統一發送更新，不讓 Observer 私下改發 cue/condition 資訊。

#### Browser / Task Surfaces

- [ ] Host/Admin 已開啟 Admin dashboard，確認 room name、task、condition、phase、timer 與 export 按鈕可見。
- [ ] Task 1 的 OmniObserve participant link 已用測試帳號開過一次，確認可載入、可看到正確 task UI。
- [ ] Task 2 的 OmniObserve participant link 已用測試帳號開過一次，確認可載入、可看到正確 task UI，但不提前發給參與者操作。
- [ ] Lost-at-Sea 15 items 可顯示且排序互動正常。
- [ ] Enhance-the-Poster 的 Canva source、海報 stimulus、component library、文字/slogan library、圖床與 reviewer feedback 摘要都已開啟在 Host 可操作的瀏覽器分頁。
- [ ] 只保留當場需要的瀏覽器分頁；關閉私人帳號、通知、聊天、無關文件與會誤投影的頁面。

#### Device / Audio / Recording

- [ ] 每位參與者筆電、充電器、耳機、麥克風、HDMI/USB-C 轉接頭已確認可用。
- [ ] 每間個別 Google Meet 已開啟錄影，錄影畫面能看清 OmniObserve/Canva，音訊能收到參與者聲音。
- [ ] OmniObserve 內嵌 Jitsi room 預期會自動開啟 noise suppression；若會議 UI 顯示相關設定，確認為開啟，若無法確認則在 incident log 記錄。
- [ ] 參與者 screen share 時，確認沒有勾選分享系統音訊或 share-tab audio，除非 Host 明確要求。
- [ ] Host/Observer 的麥克風預設關閉；需要說明時才短暫開啟，說完立即關閉。
- [ ] Staff-only fallback room 的麥克風狀態已確認；不得讓 staff 麥克風進入 participant ASR/cue pipeline。
- [ ] 第二螢幕或投影設備不播放會議聲音，避免回授或 echo。
- [ ] 若需要播放教學影片，先確認音訊輸出路徑，不讓影片聲音被 participant microphone 重複收音。
- [ ] 每個 Google Meet 錄影開始時間、負責 Observer 與檔名暫記在場次資訊表。

#### Condition / Hidden Setup Safety

- [ ] Host 私下確認本場 task order 與 condition assignment；不在參與者可見畫面開啟 counterbalance table。
- [ ] 暗樁 ID、腳本、發言提綱與 mapping table 只在 staff-only 視窗或紙本使用。
- [ ] no-cue task 的 cue UI / same-different reason cue 已確認不顯示。
- [ ] with-cue task 的 cue UI 已確認可用，但不向 no-cue 參與者透露差異。
- [ ] Observer note 表單/文件已開啟；欄位不需要參與者看到 cue/condition 或暗樁資訊。

#### Export / Stop Recording Readiness

- [ ] Host 知道每個 task 結束後要匯出 task package，並確認下載位置與檔名規則。
- [ ] Host 知道每個個別 Google Meet 錄影在該段結束後要停止，並在收尾確認檔案已保存。
- [ ] 建立 incident log 草稿；任何 link、permission、device、recording、echo、screen-share audio、ASR/cue contamination 都要記錄時間與處理方式。

### 2.2 Observer Per-room Preflight（不揭露隱藏條件）

Observer 只確認自己負責的真實參與者和個別 Meet；不要提 cue/no-cue 條件、暗樁安排、其他 participant mapping 或 staff-only room。

- [ ] 確認自己負責的 participant code 與 system id，不在受試者可見畫面顯示完整 mapping table。
- [ ] 確認受試者進入正確個別 Google Meet。
- [ ] 確認受試者螢幕分享畫面可讀，且不分享無關私人視窗。
- [ ] 確認 Google Meet 錄影已開始，並口頭告知受試者錄影正在進行。
- [ ] 確認受試者耳機/麥克風可用；若用外接麥克風，確認輸入來源正確。
- [ ] 確認 screen share 沒有分享系統音訊或分頁音訊。
- [ ] 確認 Observer 自己的麥克風關閉，只有需要協助設備時短暫開啟。
- [ ] 確認 OmniObserve Task 1 link 可開啟，participant id 與顯示名稱正確。
- [ ] 不提前開啟或操作 Task 2 link；Task 2 只在中間休息由 Host 指示後協助切換。
- [ ] 若連結或權限失效，通知 Host 統一處理，不自行改發未確認連結。

### 2.3 Host / Admin System Setup

- [ ] 依 [受試者事前通知信](../communications/受試者事前通知信.md) 寄出正式通知信。
- [ ] 完成 familiarity screener，確認三位真實參與者彼此是否認識、是否同 lab / 同專案 / 固定合作。
- [ ] 若本場目標是測量 private expression，優先安排不熟或較少固定合作的參與者。
- [ ] 若三位真實參與者過度熟悉，已決定改排、排除，或在 session summary 標記 `over_familiar_use_with_caveat`。
- [ ] 確認通知信預留約 150 分鐘，且提醒筆電、耳機、充電器、HDMI/轉接頭與麥克風測試。
- [ ] 確認通知信沒有透露 task order、cue/no-cue 條件、暗樁安排或研究假設。
- [ ] 確認每位使用者的遠距會議室都有第二螢幕；可使用會議室大電視或研究團隊自備螢幕。
- [ ] 確認每位使用者筆電可連接第二螢幕，必要 HDMI/USB-C/其他轉接頭已備妥。
- [ ] 確認第二螢幕位置可看清楚、不干擾筆電操作、且音訊不會造成回授。
- [ ] 建立 group/session ID。
- [ ] 建立三位真實參與者研究代碼：`GxxP1`、`GxxP2`、`GxxP3`。
- [ ] 建立 system id mapping table：`system_id 1/2/3/4 -> GxxP1/GxxP2/GxxP3/Confederate internal ID`。
- [ ] 確認 mapping table 不出現在受試者可見畫面或受試者信件。
- [ ] 私下標記 confederate ID，確認不出現在參與者可見畫面。
- [ ] 設定 task order。
- [ ] 設定 Lost-at-Sea condition。
- [ ] 設定 Enhance-the-Poster condition。
- [ ] 為每位參與者建立 Task 1 系統連結。
- [ ] 為每位參與者建立 Task 2 系統連結。
- [ ] 確認同一場只有一個 task 是 with cue，另一個是 no cue。
- [ ] 確認 no-cue 條件不顯示 same/different reason cue。
- [ ] 確認兩個條件都會產生 idea blocks。
- [ ] 確認 speech 與 text 來源都會寫入 idea blocks 或相關 logs。
- [ ] 確認 Public channel audio ducking：participant 在悄悄話模式時公開 Jitsi 遠端聲音會降低；切回公開發言或關閉降音 toggle 後，公開 Jitsi 遠端聲音會恢復；本機麥克風與 ASR capture 不受影響。
- [ ] 確認 chat 只能作為公開發言管道。
- [ ] 確認不使用 private chat 或其他參與者間私人文字管道。
- [ ] 為每位參與者建立不同的個別 Google Meet 連結。
- [ ] 確認各 Observer 知道自己要加入哪一位真實參與者的個別 Meet。
- [ ] 開始或準備開始各個個別 Google Meet 錄影。
- [ ] 確認 Lost-at-Sea 15 items 可顯示。
- [ ] 確認 Canva 海報與 component library 可開啟。
- [ ] 確認 Poster Canva material 是否包含 reviewer feedback，並在場次資訊填 `yes/no`。
- [ ] 確認三個 Google Forms 可開啟。
- [ ] 確認小表單與訪談題目依 [功能使用與 Skip Logic](../forms/功能使用與Skip_Logic.md) 有 `N/A / did not use / not available` 分流。
- [ ] 確認三位 Observer 知道各自負責的真實參與者。

## 3. Host 開場與教學

- [ ] 說明總長約 150 分鐘。
- [ ] 說明會完成兩個 task，中間休息 5 分鐘。
- [ ] 說明 Google Meet 錄影與系統資料保存。
- [ ] 說明 private / public / reflect phase。
- [ ] 說明 think-aloud 與文字輸入會生成 idea blocks / notes。
- [ ] 說明 chat 是正式公開發言管道，沒有 private chat。
- [ ] 若第一個 task 是 with cue，說明 similarity cue。
- [ ] 不揭露暗樁。
- [ ] 確認所有人可操作系統後開始 Task 1。

## 4. Task 控時

### 全場固定控時

- [ ] 報到、設備、第二螢幕、Google Meet 錄影與研究說明：8 分鐘。
- [ ] 系統教學與 Task 1 說明：10 分鐘。
- [ ] Task 2 說明與系統確認：5 分鐘。
- [ ] 中間正式休息：5 分鐘。
- [ ] 個別訪談：30 分鐘。
- [ ] 最後 Debrief：5 分鐘。
- [ ] 收尾資料確認：5 分鐘。

### Lost-at-Sea

- [ ] Private phase：8 分鐘。
- [ ] Public phase：20 分鐘。
- [ ] Reflect phase：2 分鐘。
- [ ] 小訪談 / 小表單：10 分鐘。

### Enhance-the-Poster

- [ ] Private phase 1：5 分鐘。
- [ ] Private phase 2：7 分鐘。
- [ ] Public phase：20 分鐘。
- [ ] Reflect phase：2 分鐘。
- [ ] 小訪談 / 小表單：10 分鐘。

### 全場長度核對

- [ ] 固定非 task 時間共 38 分鐘。
- [ ] Lost-at-Sea 固定 30 分鐘。
- [ ] Enhance-the-Poster 固定 34 分鐘。
- [ ] 兩次小訪談 / 小表單共 20 分鐘。
- [ ] Debrief 前個別訪談 30 分鐘。
- [ ] 最後 Debrief 5 分鐘。
- [ ] 全場合計暫定 152 分鐘；若需要壓回 150 分鐘，由 #103 統一調整，不在現場臨時刪減 ranking 時間。

### 中間休息與 Task 2 連結切換

- [ ] 確認 Task 1 ranking、transcript、idea blocks、cue logs、public chat、個別 Meet 錄影都有記錄。
- [ ] 確認所有參與者不要自行提前開啟或操作 Task 2。
- [ ] 三位 Observer 協助各自負責的真實參與者開啟 Task 2 系統連結。
- [ ] Host/Admin 依 mapping table 確認每位參與者進入正確 system id。
- [ ] 確認 Task 2 condition 正確：with cue 或 no cue。
- [ ] 確認個別 Google Meet 錄影仍在進行。

## 5. Lost-at-Sea Admin Checklist

- [ ] 切到 Lost private phase。
- [ ] 確認每人可做 15 items 個人排序。
- [ ] 開始 8 分鐘 timer。
- [ ] 確認 think-aloud transcript / idea blocks 有產生。
- [ ] 確認文字輸入也被記錄並可對應到 participant。
- [ ] 切到 public phase。
- [ ] 確認 group ranking 需排序 15 items。
- [ ] 開始 20 分鐘 timer。
- [ ] 若 Lost 是 with cue，監控 same/different reason cue。
- [ ] 若 Lost 是 no cue，確認 cue disabled。
- [ ] 切到 reflect phase。
- [ ] 確認每位真實參與者調整 final personal ranking。
- [ ] 檢查 Lost logs 是否寫入。

## 6. Poster Admin Checklist

- [ ] 切到 Poster private phase 1。
- [ ] 確認 Canva 海報與 component library 可見。
- [ ] 確認本輪 Poster material 是否包含 reviewer feedback；若沒有，Host 說明不得承諾 review 存在。
- [ ] 開始 5 分鐘 timer。
- [ ] 確認每位參與者建立至少 4 個 component + action items。
- [ ] 確認 component + action item 文字會進入 logs / idea block pipeline。
- [ ] 切到 Poster private phase 2。
- [ ] 鎖定 item 內容。
- [ ] 產生可排序 item list。
- [ ] 開始 7 分鐘 timer。
- [ ] 在 Admin dashboard 的 ranking state / private ranking 欄位確認每位真實參與者都有完成訊號：private ranking revision 至少為 `r1`，或 participant 明確口頭 / 聊天確認已完成排序；系統剛產生的 `r0` seeded ranking 不算完成。
- [ ] 若有真實參與者尚未出現完成訊號，先口頭提醒並延後切 phase；若仍未完成，記錄 participant ID、原因與當下時間，再切 public phase。
- [ ] 切到 public phase。
- [ ] 確認 group ranking 最多選 15 items，且由最重要排到最不重要。
- [ ] 開始 20 分鐘 timer。
- [ ] 若 Poster 是 with cue，監控 same/different reason cue。
- [ ] 若 Poster 是 no cue，確認 cue disabled。
- [ ] 切到 reflect phase。
- [ ] 確認每位真實參與者調整 final personal ranking。
- [ ] 檢查 Poster logs 是否寫入。

## 7. 小訪談 / 小表單 Checklist

- [ ] 判斷剛完成 task 是 no cue 還是 with cue。
- [ ] no cue 使用小表單 A：<https://docs.google.com/forms/d/1hultQhpxqw-Q-i9u8StCVhbxSf2eQTAtsZM1SWQ1TdM/edit>
- [ ] with cue 使用小表單 B：<https://docs.google.com/forms/d/1qAmfWRzsvMttPvgKtmDGbYhZ-pHvkdQHXVNgwDcvNlc/edit>
- [ ] 小表單或 notes 有記錄本輪熟悉度、公開反對舒適度，以及熟悉度是否影響整理想法、查看可用提示或公開表達。
- [ ] 三位 Observer 分別口頭詢問自己的真實參與者。
- [ ] 每位真實參與者都是一對一口頭詢問；參與者不自行填小表單。
- [ ] 先確認 idea blocks、reviewer feedback、similarity cue 是否可用 / 有看到 / 有使用，再問後續評價題。
- [ ] 若參與者沒有使用或功能沒有提供，依 [功能使用與 Skip Logic](../forms/功能使用與Skip_Logic.md) 填 `N/A` 原因，不強迫回答 usefulness。
- [ ] Observer 代填表單。
- [ ] 暗樁不填正式參與者表單。
- [ ] 確認三份表單送出。

## 8. Observer Checklist

### 觀察原則

- [ ] 只記錄，不引導。
- [ ] 不主動提醒參與者把 private idea 說出來。
- [ ] 不評價 Lost 物品排序或 Poster action items。
- [ ] 不揭露暗樁。
- [ ] 記錄具體事件，最後訪談用事件追問。

### Lost-at-Sea 觀察

- [ ] 參與者 private ranking 的理由。
- [ ] 參與者是否 think aloud。
- [ ] 若參與者有看到或使用 idea blocks，記錄是否幫助回顧理由；若沒有使用，記錄 `N/A` 原因。
- [ ] public phase 中是否提出 private 階段理由。
- [ ] cue 條件下是否因 same/different reason cue 發言或改變排序。
- [ ] reflect phase 是否調整個人排序。

### Poster 觀察

- [ ] 參與者是否能理解 Canva / component library。
- [ ] phase 1 是否至少建立 4 個 items。
- [ ] items 是否包含 component + action。
- [ ] public phase 是否討論最多 15 個 items 的排序。
- [ ] 是否出現不同設計方向。
- [ ] 若材料包含 reviewer feedback，記錄參與者是否引用；若沒有包含，訪談與表單標記 `N/A_not_available`。
- [ ] cue 條件下是否因 same/different reason cue 發言或補充理由。
- [ ] reflect phase 是否調整個人排序。

### 建議 note 欄位

| 欄位 | 說明 |
| --- | --- |
| group_id | 場次 |
| participant_id | 負責參與者 |
| task | lost_at_sea / enhance_poster |
| condition | no_cue / with_cue |
| phase | private / public / reflect / form / interview |
| timestamp | HH:MM:SS |
| event_type | private_idea / public_speech / public_chat / cue_reaction / ranking_change / confusion / incident |
| observed_event | 具體看到/聽到的事件 |
| related_item | Lost item 或 Poster component/action |
| cue_type | none / same_reason / different_reason |
| idea_blocks_use_status | used / not_used / not_seen / not_available / technical_issue |
| review_feedback_status | used / not_used / not_available / not_poster_task / technical_issue |
| followup_question | 最後訪談要追問的問題 |
| group_familiarity_context | none / low / medium / high / mixed / unknown |
| familiarity_followup_needed | yes / no |

## 9. 個別訪談分流與最後 Debrief

- [ ] 兩個 task 和兩次小表單完成。
- [ ] 三位 Observer 分別帶三位真實參與者到不同地方。
- [ ] 確認暗樁不參與三位真實參與者個別訪談。
- [ ] 訪談前與訪談中不揭露暗樁，不暗示有人是研究團隊安排成員。
- [ ] 訪談追問使用中性說法，例如「某位成員」「有人」「剛才那段討論」。
- [ ] 詢問熟悉度是否影響公開反對、整理想法、查看可用提示或公開表達；不要在受試者可見題幹列出分析 tag。
- [ ] 若參與者表示「因為很熟所以直接公開說」或「因為不熟所以先記在 private」，將原話摘要寫入 notes。
- [ ] 確認三場訪談彼此分開，不能互相聽見。
- [ ] 各自開始約 30 分鐘個別訪談。
- [ ] 訪談錄音或筆記開始。
- [ ] 訪談完成後確認大表單和訪談資料保存。
- [ ] 三場個別訪談都完成後，Host 或 Debrief 影片進行最後 Debrief。
- [ ] Debrief 說明其中一位是暗樁。
- [ ] Debrief 說明暗樁目的不是評價能力。
- [ ] Debrief 後不再進行研究訪談，只處理參與者提問與收尾。
- [ ] 記錄 Debrief 完成時間。

## 10. 資料收尾 Checklist

- [ ] 停止 Google Meet 錄影。
- [ ] 確認 Google Meet 錄影檔案保存。
- [ ] 匯出 Lost rankings。
- [ ] 匯出 Poster rankings。
- [ ] 匯出 transcripts。
- [ ] 匯出 idea blocks。
- [ ] 匯出 cue logs；no-cue task 標記 cue disabled。
- [ ] 匯出 public chat logs。
- [ ] 匯出 Google Forms responses。
- [ ] 保存 familiarity screener 與 task 後熟悉度回答。
- [ ] 保存每位真實參與者的個別 Google Meet 錄影。
- [ ] 保存 participant mapping table。
- [ ] 收齊三位 Observer notes。
- [ ] 保存三份個別訪談錄音 / transcript。
- [ ] 確認最後 Debrief 已完成。
- [ ] 建立 session summary。
- [ ] 在 session summary 填入 group familiarity level、recruitment decision、private-channel usage caveat。
- [ ] 建立 incident log。
- [ ] 檢查命名符合 [資料命名與輸出規格](../data/資料命名與輸出規格.md)。
