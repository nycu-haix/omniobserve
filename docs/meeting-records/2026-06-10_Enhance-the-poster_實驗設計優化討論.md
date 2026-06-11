# 2026-06-10 Enhance-the-poster 實驗設計優化討論

- PLAUD file ID: `ed87f0e5db94e6836d1acce6c5e4b61b`
- Recording name: OmniObserve Enhance-the-poster 實驗設計優化討論：提升設計任務的複雜度以誘發多元觀點
- Created: 2026-06-10 09:36:27
- Start: 2026-06-10 09:36:13
- Duration: 34m15s
- Source type: PLAUD AI note

## 摘要

本次討論由 Grace 主導，核心是修正目前 Enhance the Poster 使用者實驗的任務設定。Grace 指出，原本的海報修改任務過於簡單、選項太少，參與者容易提出相同意見，討論只剩排序優先度差異，而不是多個合理設計方向的競爭。若實驗要觀察 private phase 到 public phase 的想法轉換、主流意見如何形成、少數觀點是否被表達，任務本身必須創造 competing viewpoints。

Grace 建議擴大設計空間、增加圖片與文字選項、引入 conflicting feedback，並把設計資源外部化到 Google Slides 或類似文件。系統中保留簡化的文字 action item 輸入，不把所有圖片、圖示、slogan、背景和設計元件塞進 OmniObserve UI。參與者在 private/public phase 中只看海報和資源，不直接編輯圖片或 canvas，而是用文字描述修改意圖。

## 問題診斷

- 現有 task 太 trivial，參與者幾乎都同意同一批修改。
- 討論差異主要是「哪個修改比較重要」或排序，而不是不同設計方向的取捨。
- 直觀錯誤如主標題放大、明顯偏位元素移回中間，不足以形成可辯論觀點。
- 若參與者都聽得懂彼此想法，實驗真正要測的不是理解能力，而是 private idea 是否被揭露、是否有人在主流壓力下保留想法。
- 讓參與者同時編輯 Canva 或海報可能讓擅長操作的人主導，也增加 UI 負擔。

## 核心決策

1. 任務要創造多個合理 competing viewpoints。
2. 重點不是把海報做成不同風格，而是讓不同修改方向都合理、可被支持、可彼此競爭。
3. 增加可選設計資源：slogan、subtitle、information text、images、elements、background。
4. 加入 conflicting feedback，使參與者解讀回饋時自然形成不同 action。
5. 設計資源外部化，不放進系統主介面。
6. 系統 action item 區域維持文字即可。
7. 參與者可用資源 ID 或自創文字描述修改，例如更換 slogan、移除 image ID、新增 image resource。
8. Private phase 與 public phase 不要求參與者直接修改圖片。

## 任務材料要求

Grace 建議外部材料中至少包含：

- 第一頁 task instruction、prompt、requirements。
- 可選主標題或 slogan，約 5 個方向。
- 副標題與 information text 選項。
- 大量 available images，例子中提到可達約 20 個圖片資源。
- 原海報既有圖片也納入 image library，並標清楚 ID。
- elements，例如圓形、方形、三角形等小圖形。
- background 選項，例如背景顏色。
- 3 到 5 個或更多 conflicting feedback。

## 系統設計含意

- OmniObserve 不需要承擔完整設計工具功能。
- 參與者不需要在系統中操作複雜設計元件。
- action item 可以是純文字，例如：
  - `Replace title with Slogan S1`
  - `Remove Image I02`
  - `Add Image I14`
  - `Create new slogan`
- 系統應避免呈現過多重複或不必要 UI。
- 若目前介面有左右相似功能，正式實驗可先移除或不啟用。

## 對 Procedure 文件的影響

本次會議覆蓋舊版「只讓參與者找出海報明顯問題並排序」的任務設計。正式 procedure 應改成：

- 先準備外部設計資源與 conflicting feedback。
- 參與者先個人閱讀材料、建立 3 到 4 個文字 action items。
- 系統整理並匿名打亂 action item list。
- 參與者對所有 action items 做個人排序。
- 小組討論形成 group ranking。
- cue 條件觀察 same reason、different reason、shared alignment、private-public mismatch。
- 訪談追問設計方向衝突、是否不敢公開、cue 是否幫助、是否不直接編輯海報造成影響。

## Action Items

### Grace / Task material owner

- [ ] 重新設計任務情境，使其能產生合理 competing viewpoints。
- [ ] 擴大設計選項，避免所有參與者提出相同修改。
- [ ] 增加主標題、副標題、information text 等文字選項。
- [ ] 增加大量圖片選項並建立 ID。
- [ ] 整理 images、text、elements、background 類別。
- [ ] 將資源移到外部 deck/PDF/Google Slides。
- [ ] 在外部材料第一頁寫清楚 task instruction、prompt、requirements。
- [ ] 設計 conflicting feedback。

### Sky / System owner

- [ ] 將圖片、圖示與視覺資源搬到系統外部。
- [ ] 保留文字形式 action item。
- [ ] 調整流程，使參與者只看圖片並用文字描述修改意圖。
- [ ] 檢視並避免正式實驗中使用不必要的重複 UI。
