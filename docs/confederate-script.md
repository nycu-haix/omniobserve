# 暗樁參與者發言提綱索引

本文件是暗樁稿的總入口，和目前系統支援的 task prompt list 對齊。目前正式使用的是下列兩份中文內部稿，分別對應兩個不同 task；兩份都是現行版本，沒有新舊或取代關係。

本文件與所有暗樁稿都僅供研究團隊內部準備使用，請勿提供給一般參與者。

## 目前系統 task prompt list

目前後端 task prompt list 來源為 `backend/app/task_config/registry.py`，支援兩個 task：

| task_id | 系統任務名稱 | 正式中文暗樁稿 |
| --- | --- | --- |
| `lost-at-sea` | Lost at Sea | [Lost-at-Sea 暗樁發言提綱](confederate-script.zh.md) |
| `enhance-the-poster` | Enhance the Poster | [Enhance-the-Poster 暗樁發言提綱](confederate-script-enhance-the-poster.zh.md) |

正式實驗同一組會連續完成兩個 task，因此暗樁應在實驗前讀完兩份稿，並依當輪 task 使用對應立場。若仍看到英文 Lost-at-Sea-only 草稿，僅視為歷史參考，不列入正式實驗使用文件。

## 共通原則

暗樁在兩個 task 中都應扮演一般參與者。核心任務不是讓小組得到特定答案，而是提出合理但可被討論的公開立場，讓真實參與者有機會出現 private disagreement、shared unspoken thought 或公開反駁。

暗樁應該：

- 有清楚但不絕對的判斷邏輯。
- 自然發言，不像在背稿。
- 在提出強立場後停頓，讓其他人有空間回應。
- 在小地方讓步，避免把討論壓成單一路線。
- 詢問其他人的理由，讓真實參與者有機會說明不同觀點。
- 只使用任務內可見資訊，不假裝有外部專業權威。

暗樁不應該：

- 提到研究目的、系統提示、cue、backchannel、實驗條件或暗樁身分。
- 暗示自己是研究團隊安排的人。
- 攻擊或嘲笑其他參與者。
- 在小組已清楚拒絕某立場後仍反覆壓迫討論。
- 在三位真實參與者的 Debrief 前個別訪談中受訪。

## 兩個 task 的公開立場

### Lost-at-Sea

暗樁立場偏向「方向感、基本資訊、長期生存工具」。這會和標準答案中更重視求救訊號的排序形成張力。

使用文件：[confederate-script.zh.md](confederate-script.zh.md)

### Enhance-the-Poster

暗樁立場偏向「資訊清楚、報名轉換、掃讀效率、QR Code 和底部資訊整合」。這會和其他可能重視活潑感、視覺新鮮度、圖片替換或標語創意的方向形成張力。

使用文件：[confederate-script-enhance-the-poster.zh.md](confederate-script-enhance-the-poster.zh.md)

## 維護規則

- 若 `backend/app/task_config/registry.py` 新增或移除 task，這份索引必須同步更新。
- 若 task id 改名，更新本文件、兩份暗樁稿與 [Similarity Detection Eval Prompt](similarity_eval_prompt.md)。
- 若只調整暗樁話術，不需要改系統 prompt；但要在 session summary 記錄實驗當天實際使用的暗樁稿版本。
