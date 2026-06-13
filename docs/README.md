# OmniObserve 正式實驗 Procedure 文件包

本資料夾是正式實驗操作文件，不是送審表單或倫理審查附件。目標是讓新加入的研究人員只讀這份文件包，就能知道如何準備、執行、記錄與收尾一場完整 OmniObserve 實驗。

## 文件使用順序

1. 先讀 [正式實驗 Procedure](procedure/OmniObserve_正式實驗Procedure.md)，掌握完整流程、時間配置與每個階段要說什麼、做什麼、記什麼。
2. 寄信前讀 [受試者事前通知信](communications/受試者事前通知信.md)，確認時間、地點、攜帶設備與不可透露資訊。
3. 實際執行前讀 [主持人 Admin Observer Checklists](procedure/主持人_Admin_Observer_Checklists.md)，先完成 staff-only Run-of-show Preflight 與 Observer Per-room Preflight，再依角色分工檢查設備、系統、錄音錄影、後台與資料匯出。
4. 準備 Lost-at-Sea 時讀 [Lost-at-Sea 任務設計](task-materials/Lost_at_Sea_任務設計.md)。
5. 準備 Enhance-the-Poster 時讀 [Enhance-the-Poster 任務設計](task-materials/Enhance_the_Poster_任務設計.md)，並確認 Canva / component library 版本。
6. 準備暗樁時先讀 [暗樁參與者發言提綱索引](confederate.md)，再依 task 讀 [Lost-at-Sea 暗樁發言提綱](confederate-sea.md) 與 [Enhance-the-Poster 暗樁發言提綱](confederate-poster.md)。這些文件只供研究團隊內部使用，不得提供給一般參與者。
7. 準備表單與訪談時讀 [問卷與訪談題綱](forms/問卷與訪談題綱.md) 與 [Google Forms 第一版題目快照](forms/Google_Forms_第一版題目快照.md)，以三份 Google Forms 為正式來源。
8. 收尾資料時讀 [資料命名與輸出規格](data/資料命名與輸出規格.md)。
9. 需要追溯 Poster task 設計來源時讀 [2026-06-10 Plaud 會議記錄](meeting-records/2026-06-10_Enhance-the-poster_實驗設計優化討論.md)。
10. 測試 similarity detection prompt 時讀 [Similarity Detection Eval Prompt](similarity_eval_prompt.md)，它已和目前 `lost-at-sea` / `enhance-the-poster` task prompt list 對齊。

## 來源優先順序

1. 2026-06-12 使用者正式流程補充與後續修正：150 分鐘、兩個 task、within-subject、暗樁、人員配置、場前通知信、表單方式、Debrief 在個別訪談後、資料輸出與 Canva 來源。
2. 2026-06-10 Grace 討論 Plaud 記錄：海報任務複雜度、外部化資源、conflicting feedback 與文字 action items。
3. 三份 Google Forms 第一版：no-cue 小表單、with-cue 小表單、兩個 task 後大表單。
4. 目前 Notion 實驗與設計頁面：設計表單題目想法、Action items & components、Make it ugly、components/actions 補集合等。
5. 本 repo 既有會議記錄與系統 SOP：用於 admin、observer、資料匯出、phase 控制與歷史決策。
6. 舊 single-session protocol：只作為主持腳本、時間安排與問題意識參考，不作為正式版本的角色安排。

## 正式版本核心決策

- 一場正式實驗約 150 分鐘，包含 Lost-at-Sea、Enhance-the-Poster、兩次 task 後小訪談/小表單、三位真實參與者的個別訪談，以及最後 Debrief。
- 每場 4 人一組，其中 3 位真實參與者、1 位暗樁；Debrief 前不揭露暗樁。
- 三位真實參與者的個別訪談必須在 Debrief 前完成；訪談中不得提到暗樁、研究團隊安排成員或任何暗示身分的說法。
- Lost-at-Sea 與 Enhance-the-Poster 的順序可 counterbalance；近期兩組暫定都先 Lost 後 Poster，但不得寫死。
- 兩個 task 中，一個是 no cue，另一個是 with cue；task-condition assignment 要 counterbalance。近期 G01/G02 使用 Lost first，增加 G03/G04 時開始 counterbalance task order。
- 目前系統不支援同一個 group 在同一連結連續跑兩個 tasks；每位參與者會使用兩個 OmniObserve system links。
- 每位參與者使用不同的個別 Google Meet link 做外部錄影 workaround；screen recording 不是 OmniObserve 主要功能。
- 兩個條件都有 idea blocks，來源包含 speech 與 text；只有 with-cue 條件有 same reason / different reason Similarity Cue。
- Public chat 是唯一文字聊天管道；不使用 private chat。
- Poster 使用 Canva 與 component library；參與者不直接修改海報，而是建立 component + action items。
- 找不到或尚未開啟的來源不得補猜；未確認事項應保留在對應正式文件的 TBD 或 session summary 中。
- Slack 討論尚未納入本文件包；不得憑記憶或推測補寫 Slack 內容。
