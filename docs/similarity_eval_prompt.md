# Similarity Detection Eval Prompt

本文件用來測試 LLM 是否符合目前 OmniObserve similarity detection policy。它已和目前系統 task prompt list 對齊：

- `backend/app/task_config/registry.py`
- `backend/app/task_config/lost_at_sea.py`
- `backend/app/task_config/enhance_the_poster.py`
- `backend/app/services/similarity_detection.py`

舊版 eval prompt 只涵蓋 Lost-at-Sea，且物品清單包含過期名稱，例如 offline GPS、Atlantic map、water container。新版應使用下列 task ids、task item/component/action 清單與 output contract。

## 目前系統 prompt list

### `lost-at-sea`

系統任務名稱：Lost at Sea

Similarity context：參與者正在針對 15 項工具進行排序，分析必須基於海上漂流情境。

目前系統物品清單：

| id | label |
| --- | --- |
| `sextant` | 六分儀 |
| `shaving_mirror` | 刮鬍鏡／小鏡子 |
| `water_container` | 20L 飲用水 |
| `mosquito_net` | 蚊帳 |
| `emergency_rations` | 一箱緊急口糧 |
| `sea_chart` | 太平洋地圖 |
| `floating_cushion` | 救生坐墊 |
| `petrol` | 8L 油氣混合燃料 |
| `receive_only_radio` | 電晶體收音機 |
| `shark_repellent` | 防鯊劑 |
| `waterproof_sheet` | 2m² 不透明塑膠布 |
| `rum` | 1L 80% 蘭姆酒 |
| `rope` | 5m 尼龍繩 |
| `chocolate_bars` | 兩盒巧克力棒 |
| `fishing_rod` | 釣魚工具組 |

### `enhance-the-poster`

系統任務名稱：Enhance the Poster

Similarity context：參與者正在針對淨灘活動招募海報建立改善項目，並在後續階段排序前 10 個最重要的改善項目。分析必須基於提升海報招募效果的目標。

目前系統 poster components：

| id | label |
| --- | --- |
| `main_title` | 主標題 |
| `subtitle` | 副標題 |
| `description` | 說明文字 |
| `date` | 日期時間 |
| `location` | 地點 |
| `cta` | 行動呼籲 |
| `qr_code` | QR 碼 |
| `qr_caption` | QR 碼說明 |
| `organizer_list` | 協辦單位 |
| `reminder` | 注意事項 |
| `contact_info` | 聯絡資訊 |
| `icon` | 人物圖示 |
| `beach_background` | 海灘背景圖 |
| `blue_block` | 下方藍色區塊 |
| `title_group` | 主標題+副標題+說明 |
| `info_group2` | 日期時間+地點+行動呼籲 |
| `info_group` | 下方資訊 |

目前系統 action list：

| id | label |
| --- | --- |
| `remove` | 去除 |
| `replace1` | 替換成人物圖示1 |
| `replace2` | 替換成人物圖示2 |
| `move` | 移動 |
| `enlarge` | 放大 |
| `shrink` | 縮小 |
| `change_color` | 改顏色 |
| `change_font` | 調整字型 |
| `adjust_spacing` | 調整間距 |
| `spread_out` | 分散 |
| `assemble` | 集合 |
| `unify_font` | 統一字型 |
| `unify_color` | 統一顏色 |
| `transparency` | 調整透明度 |
| `align_left` | 向左對齊 |
| `align_right` | 向右對齊 |
| `align_center` | 置中對齊 |
| `replace_slogan_library` | 替換成 Slogan |
| `replace_image_library` | 替換成圖片 |
| `custom_detail` | 自訂動作 |

## Runtime output contract

目前 `backend/app/services/similarity_detection.py` 的 runtime LLM call 使用 core idea + candidate list，並期待 JSON：

```json
{"matches":[{"id":123,"reason":"Brief reason.","is_same_reason":true}]}
```

若沒有相似候選：

```json
{"matches":[],"reason":"No similar ideas found"}
```

本 eval prompt 是用來檢查已產生的 similarity records 是否合理，因此 eval output 使用 `results`，不是 runtime `matches`。

## Eval Prompt

```text
# Role
You are evaluating similarity-detection records produced by OmniObserve.

Your job is to judge whether each existing similarity record should be accepted or rejected under the current policy. Do not create new candidate pairs. Only evaluate the provided records.

# Current Task Prompt List

OmniObserve currently supports these task IDs:

1. `lost-at-sea`
Participants rank 15 sea-survival items by importance in a drifting-at-sea scenario. A useful similarity cue should support consensus-building by surfacing compatible ranking intuitions.

Valid task item IDs:
- sextant: 六分儀
- shaving_mirror: 刮鬍鏡／小鏡子
- water_container: 20L 飲用水
- mosquito_net: 蚊帳
- emergency_rations: 一箱緊急口糧
- sea_chart: 太平洋地圖
- floating_cushion: 救生坐墊
- petrol: 8L 油氣混合燃料
- receive_only_radio: 電晶體收音機
- shark_repellent: 防鯊劑
- waterproof_sheet: 2m² 不透明塑膠布
- rum: 1L 80% 蘭姆酒
- rope: 5m 尼龍繩
- chocolate_bars: 兩盒巧克力棒
- fishing_rod: 釣魚工具組

2. `enhance-the-poster`
Participants improve a beach-cleanup recruitment poster by proposing component + action task items and later ranking the top 10 most important improvements. A useful similarity cue should support discussion by surfacing compatible poster-improvement intuitions.

Valid poster component IDs:
- main_title: 主標題
- subtitle: 副標題
- description: 說明文字
- date: 日期時間
- location: 地點
- cta: 行動呼籲
- qr_code: QR 碼
- qr_caption: QR 碼說明
- organizer_list: 協辦單位
- reminder: 注意事項
- contact_info: 聯絡資訊
- icon: 人物圖示
- beach_background: 海灘背景圖
- blue_block: 下方藍色區塊
- title_group: 主標題+副標題+說明
- info_group2: 日期時間+地點+行動呼籲
- info_group: 下方資訊

Valid action IDs:
- remove, replace1, replace2, move, enlarge, shrink, change_color, change_font
- adjust_spacing, spread_out, assemble, unify_font, unify_color, transparency
- align_left, align_right, align_center
- replace_slogan_library, replace_image_library, custom_detail

# Core Similarity Definition

A record is acceptable only when the two idea blocks share a compatible practical recommendation for the same task.

For `lost-at-sea`, this means a compatible ranking stance:
- both prioritize the same item,
- both deprioritize the same item,
- both imply the same item should move up or down,
- both compare the same items in the same direction,
- or both recommend a compatible survival strategy.

For `enhance-the-poster`, this means a compatible poster-improvement stance:
- both recommend the same or equivalent edit to the same component,
- both prioritize/deprioritize the same poster improvement,
- both target the same visual or information problem with compatible edits,
- or both make compatible recommendations about component hierarchy, grouping, readability, QR scanability, CTA clarity, or visual emphasis.

Similarity does not require the same reason. Two ideas may be similar even when their reasons differ, as long as their practical recommendation is compatible.

# Similarity Criteria

Mark a record as accepted only if ALL of the following are true:

1. Same decision target
- `lost-at-sea`: same item, same comparison pair, or same survival strategy.
- `enhance-the-poster`: same component, same edit action, same advanced edit method, or clearly equivalent poster improvement.

2. Compatible practical recommendation
The two ideas imply a similar ranking direction, design edit, priority judgment, or group recommendation.

3. Concrete evidence
At least one idea gives a concrete rank, priority, comparison, edit action, design effect, survival use, visual reason, or information-architecture reason.

4. Meaningful discussion bridge
The match would reasonably help a participant feel: "Someone else has a similar intuition, so I can build on or compare with that idea."

# Same Reason Classification

After deciding that a record is accepted, classify `corrected_is_same_reason`:

- `true`: the practical recommendation is similar AND the primary reason/effect is also similar.
- `false`: the practical recommendation is similar BUT the primary reason/effect is different.

Use `true` when one idea is more detailed but its main rationale overlaps with the other. Use `false` only when the similar recommendation comes from genuinely different mechanisms, intended uses, visual effects, or participant concerns.

Examples:
- `lost-at-sea`: "Mosquito net should be low because there are no mosquitoes" and "Mosquito net is useless at sea because there are no insects" => same reason.
- `lost-at-sea`: "Plastic sheet should rank high because it collects rainwater" and "Plastic sheet should rank high because it provides shade" => different reason.
- `enhance-the-poster`: "Enlarge QR code so people can scan it" and "Make QR code bigger because registration is the key action" => same reason.
- `enhance-the-poster`: "Move QR code near date info for layout balance" and "Move QR code near caption so people understand it is registration" => different reason.

# Reject Conditions

Return `accepted: false` if any of the following apply:

- The ideas merely mention the same item or component.
- Both ideas only use generic praise or importance words without a concrete recommendation.
- The practical recommendation is unclear, neutral, or too generic.
- One idea prioritizes while the other deprioritizes the same target.
- The ideas compare the same targets in opposite directions.
- One idea asks whether an edit/use is possible and the other asserts it as valuable.
- The match would not create a meaningful bridge for discussion or consensus-building.

# Evaluation Task

Evaluate each record in `TEST_RECORDS`.

Input record shape:
{
  "id": 1,
  "task_id": "lost-at-sea | enhance-the-poster",
  "idea_block_id_1": 100,
  "idea_block_id_2": 101,
  "reason": "Original system reason.",
  "is_same_reason": true,
  "idea_block_1": {"summary": "...", "task_items": ["..."], "poster_components": ["..."], "actions": ["..."]},
  "idea_block_2": {"summary": "...", "task_items": ["..."], "poster_components": ["..."], "actions": ["..."]}
}

Important: If the pair is correctly accepted but the provided `is_same_reason` value is wrong, set:
- `accepted: true`
- `verdict: "wrong_reason_flag"`
- `corrected_is_same_reason` to the corrected value.

Return JSON only:
{
  "results": [
    {
      "id": 1,
      "accepted": true,
      "corrected_is_same_reason": false,
      "verdict": "reasonable | too_weak | wrong_pair | wrong_reason_flag",
      "explanation": "Short explanation."
    }
  ],
  "summary": {
    "accepted_count": 0,
    "rejected_count": 0,
    "wrong_reason_flag_count": 0
  }
}

TEST_RECORDS:
[
]
```
