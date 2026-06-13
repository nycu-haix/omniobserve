# 功能使用與 Skip Logic

本文件定義小表單、最終大表單與個別訪談的最低 skip logic。目的不是新增研究假設，而是避免表單題目預設參與者一定看到或使用過某個功能。

## 1. 適用原則

- 每次問到 idea blocks、reviewer feedback、similarity cue 或任何 condition-specific 功能前，先記錄該功能是否可用、參與者是否注意到、以及是否實際使用。
- 若功能在該 task / condition 中沒有提供，後續「有沒有幫助」「為什麼使用」「是否影響決策」等題目一律標記 `N/A_not_available`，不要要求參與者猜測。
- 若功能有提供但參與者沒有注意到或沒有使用，後續 usefulness rating 一律標記 `N/A_did_not_use`；可以改問「為什麼沒有使用」。
- Observer 代填表單時，要用中性語句確認，不要暗示某個功能應該出現或應該被使用。
- 如果系統故障導致功能原本應出現但沒有出現，表單填 `N/A_technical_issue`，並在 incident log 補具體原因。

## 2. 小表單前置欄位

每份 task 後小表單至少先放下列欄位。欄位可用單選題、核取方塊或下拉選單；實際 Google Forms 文字可依語氣調整，但語意不得省略。

| 欄位 | 適用 | 選項 |
| --- | --- | --- |
| `task` | 全部 | `lost_at_sea` / `enhance_poster` |
| `condition` | 全部 | `no_cue` / `with_cue` |
| `idea_blocks_available` | 全部 | `yes` / `no` / `technical_issue` / `unsure` |
| `idea_blocks_seen` | 全部 | `yes` / `no` / `unsure` |
| `idea_blocks_used` | 全部 | `yes` / `no` / `not_available` / `technical_issue` |
| `review_feedback_available` | Poster | `yes` / `no` / `technical_issue` / `not_poster_task` |
| `review_feedback_used` | Poster | `yes` / `no` / `not_available` / `technical_issue` / `not_poster_task` |
| `similarity_cue_available` | 全部 | `yes` / `no_by_condition` / `technical_issue` |
| `similarity_cue_seen` | with-cue | `yes` / `no` / `not_available` / `technical_issue` |

## 3. Idea Blocks 題目分流

先問：

> 剛才這一輪你是否有看到或使用 Idea Blocks？

分流：

| 回答 | 後續題目 |
| --- | --- |
| 有看到且有使用 | 可以問 usefulness、是否幫助回顧理由、是否幫助帶入公開討論。 |
| 有看到但沒有使用 | 不問 usefulness rating；改問「你沒有使用的主要原因是什麼？」 |
| 沒看到 / 不確定 | 不問 usefulness rating；記錄 `N/A_did_not_see` 或 `N/A_unsure`。 |
| 系統沒有提供或故障 | 不問使用經驗；記錄 `N/A_not_available` 或 `N/A_technical_issue`。 |

建議原因選項：

- `did_not_notice`
- `time_pressure`
- `preferred_speaking_directly`
- `preferred_chat_or_manual_notes`
- `content_not_useful`
- `not_generated`
- `technical_issue`
- `other`

## 4. Reviewer Feedback 題目分流

Poster task 才能問 reviewer feedback。先由 Observer 按 session summary / Canva material version 記錄材料是否包含 reviewer feedback，再問參與者是否有看或使用。

先問：

> 這一輪 Canva 材料中是否有 reviewer feedback？如果有，你剛才是否有用它判斷修改方向？

分流：

| 情況 | 後續題目 |
| --- | --- |
| 材料有 reviewer feedback，且參與者有使用 | 可以問是否影響 action item、是否造成取捨、是否和自己判斷衝突。 |
| 材料有 reviewer feedback，但參與者未使用 | 不問「feedback 有沒有幫助」；改問未使用原因。 |
| 材料沒有 reviewer feedback | 所有 reviewer feedback 題目標記 `N/A_not_available`。 |
| Observer / participant 不確定 | 標記 `unsure`，並在 session summary 對照 Canva material version 補判斷。 |

Reviewer feedback 未使用原因選項：

- `not_available`
- `did_not_notice`
- `time_pressure`
- `preferred_own_judgment`
- `feedback_too_general`
- `feedback_confusing`
- `technical_issue`
- `other`

## 5. Similarity Cue 題目分流

no-cue 條件不問 cue 使用經驗，只記錄 `similarity_cue_available=no_by_condition`。with-cue 條件先問是否看到 cue，再決定是否追問 cue 的影響。

| 情況 | 後續題目 |
| --- | --- |
| with-cue 且有看到 cue | 可以問 same reason / different reason cue 是否影響發言、是否忽略、是否改變排序。 |
| with-cue 但沒有看到 cue | 不問 cue usefulness；記錄 `N/A_no_cue_seen`。 |
| no-cue | 不問 cue usefulness；記錄 `N/A_no_cue_by_condition`。 |
| 系統應顯示但故障 | 記錄 `N/A_technical_issue` 並寫入 incident log。 |

## 6. 個別訪談追問規則

訪談者可以追問具體事件，但要先確認該功能與事件真的存在：

- 追問 idea blocks 前，先確認 participant 是否有看到或使用，並可引用 observation note 中的具體時間點。
- 追問 reviewer feedback 前，先確認該 Poster material version 是否包含 feedback。
- 追問 cue 前，先確認該 task 是 with-cue，且參與者有看到 cue 或 observer 有觀察到 cue。
- 若 participant 說沒有使用，不要要求其評估功能好壞；改問「當時你選擇不用的原因」或「你用什麼方式整理想法」。
- 若 participant 對功能名稱不熟，訪談者可用畫面位置或行為描述提示，例如「右側的 Idea Blocks 卡片」，但不要暗示正向或負向評價。

## 7. 資料標記

Google Forms 匯出與訪談逐字稿整理時，至少保留下列標記：

- `availability_status`: `available` / `not_available` / `technical_issue` / `unsure`
- `use_status`: `used` / `not_used` / `not_seen` / `not_applicable`
- `not_applicable_reason`: `not_available` / `did_not_use` / `did_not_see` / `no_cue_by_condition` / `technical_issue` / `unsure`
- `followup_allowed`: `yes` / `no`

若表單工具無法直接做條件跳題，Observer 仍需人工依本文件代填 `N/A`，並在 free-text note 寫明原因。
