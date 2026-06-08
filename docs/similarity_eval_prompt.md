# Similarity Detection Eval Prompt

Use the following prompt to test whether an LLM agrees with the current similarity-detection policy.

```text
# Role
You are evaluating similarity-detection records produced for a Lost at Sea group ranking discussion.

Your job is to judge whether each existing similarity record should be accepted or rejected under the current policy. Do not create new candidate pairs. Only evaluate the provided records.

# Task Context
Participants are ranking these 15 items by importance for surviving at sea while waiting for rescue:
- 蚊帳 (mosquito_net)
- 一罐汽油 (petrol)
- 裝水容器 (water_container)
- 刮鬍鏡／小鏡子 (shaving_mirror)
- 離線 GPS 定位器 (offline_gps_receiver)
- 緊急糧食 (emergency_rations)
- 大西洋紙本地圖 (atlantic_paper_map)
- 可漂浮的坐墊 (floating_cushion)
- 繩子 (rope)
- 巧克力棒 (chocolate_bars)
- 防水塑膠布 (waterproof_sheet)
- 釣魚竿 (fishing_rod)
- 防鯊噴劑 (shark_repellent)
- 蘭姆酒 (rum)
- 小型收音機 (receive_only_radio)

Participants must form a group consensus ranking. A useful similarity cue should support consensus-building, not merely point out that two people mentioned the same item.

# Core Similarity Definition
A candidate idea is similar only when it shares a compatible ranking stance with the core idea.

"Ranking stance" means the practical ranking direction, priority judgment, or group recommendation implied by the idea. For example:
- both prioritize the same item,
- both deprioritize the same item,
- both imply the item should be high priority,
- both imply the item should be low priority,
- both rank item A above item B,
- both rank item A below item B,
- both make a compatible recommendation about keeping, using, dismissing, or assigning value to an item.

Similarity does NOT require the same reason. Two ideas may be similar even when their reasons differ, as long as their ranking stance is compatible.

Generic positive or negative evaluations are not enough. Phrases like "good", "useful", "valuable", "important", "helpful for survival", or "helpful for rescue" do NOT establish similarity unless the idea also gives a concrete ranking signal, comparison, or survival use.
Do not infer a strong ranking stance from weak wording alone. Words like "useful", "important", or "valuable" are not enough unless the idea clearly implies a priority level, rank movement, or comparison.

# Similarity Criteria
Mark a record as accepted only if ALL of the following are true:

1. Same decision target
The two ideas discuss the same item, the same comparison pair, or the same survival strategy.

2. Compatible ranking stance
The two ideas imply a similar priority direction or practical ranking conclusion.

3. Concrete evidence
At least one of the following must be present:
- an explicit rank, rank range, priority level, or order,
- a direct comparison between items,
- a concrete survival/rescue use that explains why the item should move up or down in the ranking.

4. Meaningful discussion bridge
The match would reasonably help a participant feel: "Someone else has a similar ranking intuition, so I can build on or compare with that idea."

# Same Reason Classification
After deciding that a record is accepted, classify `corrected_is_same_reason`:

- `true`: the ranking stance is similar AND the survival rationale, intended use, or reason is also similar.
  Use `true` when the main shared rationale is the same, even if one idea adds extra supporting reasons.
  Compare the primary shared rationale, not the full set of all reasons.
  Also use `true` when one idea is more detailed, but its main rationale overlaps with the other.

- `false`: the ranking stance is similar BUT the survival rationale, intended use, or reason is different.
  Use `false` only when the primary rationale is genuinely different.
  Use `false` only when the similar ranking stance comes from different survival mechanisms or intended uses.

Examples:
- "Mosquito net is useless because there are no mosquitoes" and "Mosquito net is useless because there are no mosquitoes and it may entangle me" => `corrected_is_same_reason: true`
- "Waterproof sheet should rank high because it collects rainwater" and "Waterproof sheet should rank high because it provides shade" => `corrected_is_same_reason: false`
- "Rum should rank high because it disinfects wounds" and "Rum should rank high because it provides calories" => `corrected_is_same_reason: false`

# Reject Conditions
Return `accepted: false` if any of the following apply:

- The ideas merely mention the same item.
- Both ideas say an item is useful, but do not imply a similar ranking direction.
- Both ideas only use generic praise or importance words, such as "good", "great", "valuable", "important", "useful", "helpful for survival", or "helpful for rescue".
- The practical ranking conclusion is unclear, neutral, or too generic.
- One idea prioritizes an item while the other deprioritizes it.
- The ideas compare the same items in opposite directions.
- One idea ranks item A above item B, while the other ranks item B above item A.
- For relative comparisons, the relative order must match. "A above B" is NOT similar to "A and B are both useless" unless both ideas make the same relative ordering claim.
- Questions, doubts, or feasibility challenges are not similar to positive proposals. If one idea asks whether a use is possible and the other asserts that use as valuable, return `accepted: false`.
- The match would not create a meaningful bridge for discussion or consensus-building.

# Evaluation Task
Evaluate each record in `TEST_RECORDS`.

Important: If the pair is correctly accepted but the provided `is_same_reason` value is wrong, set:
- `accepted: true`
- `verdict: "wrong_reason_flag"`
- `corrected_is_same_reason` to the corrected value.

Return JSON only:
{
  "results": [
    {
      "id": 48,
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
  {
    "id": 48,
    "idea_block_id_1": 1039,
    "idea_block_id_2": 1038,
    "reason": "Both ideas share a compatible ranking stance by assigning the floating cushion a significant survival value (Core: important for non-swimmers; Candidate: should be in the middle of the list), whereas other candidates either deprioritize it or discuss it in a confusing comparison. The specific reasons differ as one focuses on buoyancy for non-swimmers and the other on a general mid-tier placement.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1039, "summary": "我覺得因為我不會游泳，所以漂浮坐墊能讓我浮在水面上不沉下去，是維持生存的重要選擇。"},
    "idea_block_2": {"id": 1038, "summary": "我覺得可漂浮的坐墊重要性也應該排在名單的中間位置。"}
  },
  {
    "id": 49,
    "idea_block_id_1": 1042,
    "idea_block_id_2": 1034,
    "reason": "Both ideas share a compatible ranking stance by deprioritizing the offline GPS (and map) as useless for survival/rescue in this scenario. The core idea argues it is useless because knowing the location doesn't enable active rescue, while the candidate argues it is useless because the user cannot determine their position to use it; thus, the ranking stance is the same but the specific rationale differs.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1042, "summary": "我覺得離線 GPS 定位器沒用，因為就算知道位置也無法主動獲救，對等待救援沒有幫助。"},
    "idea_block_2": {"id": 1034, "summary": "我覺得離線 GPS 和大西洋紙本地圖在無法確定位置且目標是等待救援的情況下根本用不到。"}
  },
  {
    "id": 50,
    "idea_block_id_1": 1046,
    "idea_block_id_2": 1034,
    "reason": "Both ideas share a compatible ranking stance by deprioritizing the Atlantic paper map due to the inability to determine one's current location at sea. The rationale is the same: without knowing the starting position, the map is useless for navigation or rescue.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1046, "summary": "我覺得紙本地圖沒用，因為我根本不知道自己在哪，就算有地圖也看不懂或無法定位。"},
    "idea_block_2": {"id": 1034, "summary": "我覺得離線 GPS 和大西洋紙本地圖在無法確定位置且目標是等待救援的情況下根本用不到。"}
  },
  {
    "id": 51,
    "idea_block_id_1": 1049,
    "idea_block_id_2": 1039,
    "reason": "Both ideas share a compatible ranking stance by prioritizing the ability to float as the primary survival need, which implies ranking the floating cushion highly. The rationale is the same: ensuring one stays afloat to survive.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1049, "summary": "我覺得要確保能活下去，首要解決的問題是必須能夠浮在海面上。"},
    "idea_block_2": {"id": 1039, "summary": "我覺得因為我不會游泳，所以漂浮坐墊能讓我浮在水面上不沉下去，是維持生存的重要選擇。"}
  },
  {
    "id": 52,
    "idea_block_id_1": 1050,
    "idea_block_id_2": 1031,
    "reason": "Both ideas share a compatible ranking stance by prioritizing the shaving mirror for its ability to reflect sunlight as a rescue signal. The rationale is the same.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1050, "summary": "我覺得鏡子可以用來反射太陽光，這對海上求救應該很有用。"},
    "idea_block_2": {"id": 1031, "summary": "我覺得刮鬍鏡應該排在第一位，因為它可以反射光線來發出求救訊號。"}
  },
  {
    "id": 53,
    "idea_block_id_1": 1062,
    "idea_block_id_2": 1028,
    "reason": "Both ideas share a compatible ranking stance by deprioritizing the water container due to the lack of an immediate water source to fill it. The rationale is the same: the item's value is low because it cannot fulfill its function (holding water) without available water.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1062, "summary": "我覺得我不確定裝水容器要怎麼樣才能讓我們喝到正常的水。"},
    "idea_block_2": {"id": 1028, "summary": "我覺得裝水容器本身只是一個空容器，若沒有實際的水，其重要性並不高。"}
  },
  {
    "id": 54,
    "idea_block_id_1": 1057,
    "idea_block_id_2": 1030,
    "reason": "Both ideas share a compatible ranking stance that emergency rations should be prioritized higher in the ranking. The core idea states food should be ranked very high, and the candidate explicitly suggests moving emergency rations forward. The rationale is similar as both focus on the direct survival value of having food.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1057, "summary": "我覺得食物對於生存至關重要，排序應該要很前面。"},
    "idea_block_2": {"id": 1030, "summary": "我覺得應該將緊急糧食的排序移到更前面，以反映其較高的生存價值。"}
  },
  {
    "id": 55,
    "idea_block_id_1": 1053,
    "idea_block_id_2": 1044,
    "reason": "Both ideas share a compatible ranking stance by prioritizing the fishing rod for its ability to provide food (fishing), implying it should be ranked higher than items without survival utility. The rationale is the same as both explicitly focus on using the rod to catch fish for sustenance.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1053, "summary": "我覺得釣魚竿可以用來釣魚，而且如果需要線，也可以把上面的線拿下來使用。"},
    "idea_block_2": {"id": 1044, "summary": "我覺得釣魚竿相對有用，因為它可以讓我釣魚吃，確保我不會餓死。"}
  },
  {
    "id": 56,
    "idea_block_id_1": 1061,
    "idea_block_id_2": 1064,
    "reason": "Both ideas share a compatible ranking stance by prioritizing the waterproof sheet for the specific purpose of repairing the boat to prevent sinking, though the core idea adds a personal constraint (cannot swim) while the candidate focuses on the material compatibility.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1061, "summary": "我覺得防水塑膠布非常重要，因為若無法防水導致船沉沒，我不會游泳就會死掉。"},
    "idea_block_2": {"id": 1064, "summary": "我覺得防水塑膠布可以用來修補橡皮救生艇，因為它是橡膠材質且船身受損。"}
  },
  {
    "id": 57,
    "idea_block_id_1": 1070,
    "idea_block_id_2": 1034,
    "reason": "Both ideas share a compatible ranking stance by comparing the Atlantic paper map and the offline GPS receiver. Although Idea A ranks the map higher than the GPS, and Idea 1034 ranks both as useless (implying they are equally low priority or that the comparison yields no survival value), they both engage in the specific comparative judgment that these two navigation tools are ineffective or inferior in this scenario due to the inability to determine one's position. However, the rationale differs: Idea A believes the map has relative value over GPS, while Idea 1034 believes both are completely useless.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1070, "summary": "我覺得紙本地圖應該要排在離線 GPS 定位器前面，因為地圖能提供相對位置目標。"},
    "idea_block_2": {"id": 1034, "summary": "我覺得離線 GPS 和大西洋紙本地圖在無法確定位置且目標是等待救援的情況下根本用不到。"}
  },
  {
    "id": 58,
    "idea_block_id_1": 1073,
    "idea_block_id_2": 1042,
    "reason": "Both ideas share a compatible ranking stance by deprioritizing the offline GPS receiver based on the same rationale: knowing one's location is useless without a device to transmit that information to rescuers.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1073, "summary": "我覺得既然沒有裝置可以往外發送訊息，那麼即使知道位置也沒用，所以 GPS 不需要排前面。"},
    "idea_block_2": {"id": 1042, "summary": "我覺得離線 GPS 定位器沒用，因為就算知道位置也無法主動獲救，對等待救援沒有幫助。"}
  },
  {
    "id": 59,
    "idea_block_id_1": 1075,
    "idea_block_id_2": 1047,
    "reason": "Both ideas share a compatible ranking stance by deprioritizing the mosquito net to the lowest level due to the absence of mosquitoes at sea. The core idea adds a specific danger (entanglement), while the candidate focuses on uselessness, making the rationale partially different but the ranking conclusion identical.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1075, "summary": "我覺得蚊帳在海上一點用都沒有，因為沒有蟲，反而可能在我落水時纏住我導致更難逃脫。"},
    "idea_block_2": {"id": 1047, "summary": "我覺得海上應該沒有蚊子，所以蚊帳這個物品完全沒有用處。"}
  },
  {
    "id": 60,
    "idea_block_id_1": 1076,
    "idea_block_id_2": 1050,
    "reason": "Both ideas share a compatible ranking stance by prioritizing the shaving mirror for its ability to reflect sunlight for rescue signaling. The core rationale (signaling via reflection) is the same, although Idea 1076 adds an extra point about fire-starting and a specific rank range.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1076, "summary": "我覺得小鏡子可以用來反射陽光讓遠處的船發現我們，甚至可能用來生火，所以我想把它排在中間偏上的位置。"},
    "idea_block_2": {"id": 1050, "summary": "我覺得鏡子可以用來反射太陽光，這對海上求救應該很有用。"}
  },
  {
    "id": 61,
    "idea_block_id_1": 1078,
    "idea_block_id_2": 1045,
    "reason": "Both ideas share a compatible ranking stance by identifying 'starting a fire' as the specific survival use for petrol, implying it should be valued for this purpose. The rationale is the same (using petrol to create fire), although the core idea questions the feasibility while the candidate asserts the benefit.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1078, "summary": "到底要怎麼用汽油在海上生火???????"},
    "idea_block_2": {"id": 1045, "summary": "我覺得汽油可以用來生火，讓我們在海上不會感到寒冷。"}
  },
  {
    "id": 62,
    "idea_block_id_1": 1082,
    "idea_block_id_2": 1075,
    "reason": "Both ideas share a compatible ranking stance that the mosquito net should be deprioritized or considered useless because there are no mosquitoes at sea. However, the reasons differ: the core idea simply notes the absence of mosquitoes, while the candidate adds a specific negative risk (entanglement) that actively harms survival.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1082, "summary": "蚊帳應該沒有蚊子吧"},
    "idea_block_2": {"id": 1075, "summary": "我覺得蚊帳在海上一點用都沒有，因為沒有蟲，反而可能在我落水時纏住我導致更難逃脫。"}
  },
  {
    "id": 63,
    "idea_block_id_1": 1084,
    "idea_block_id_2": 1038,
    "reason": "Both ideas share a compatible ranking stance that the floating cushion should not be ranked at the bottom; the core idea argues it shouldn't be last because other items are less useful, while the candidate explicitly suggests placing it in the middle. The specific reasons differ slightly (comparative uselessness vs. specific middle placement), but the directional stance to elevate its rank is the same.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1084, "summary": "我覺得可漂浮的坐墊不應該排在排序的最後一名，因為清單中還有其他更沒用的物品。"},
    "idea_block_2": {"id": 1038, "summary": "我覺得可漂浮的坐墊重要性也應該排在名單的中間位置。"}
  },
  {
    "id": 64,
    "idea_block_id_1": 1086,
    "idea_block_id_2": 1069,
    "reason": "Both ideas share a compatible ranking stance by arguing that the rum should be prioritized (ranked higher) due to its specific survival utility. However, the rationales are different: the core idea focuses on disinfection, while the candidate focuses on calories and the bottle's reuse as a water container.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1086, "summary": "我覺得蘭姆酒雖然討論不多，但因為具有無法替代的消毒功能，所以排序靠前是合理的。"},
    "idea_block_2": {"id": 1069, "summary": "我覺得蘭姆酒能提供熱量，且喝完後的瓶子可當作裝水容器使用。"}
  },
  {
    "id": 65,
    "idea_block_id_1": 1087,
    "idea_block_id_2": 1034,
    "reason": "Both ideas share a compatible ranking stance by concluding that the Atlantic paper map (and offline GPS) has low utility or should be deprioritized in a waiting-for-rescue scenario where current position is unknown. The core idea argues the map is ineffective without GPS, while the candidate argues both are useless for waiting for rescue; the ranking conclusion (low priority) is the same, but the specific rationale differs slightly.",
    "is_same_reason": false,
    "idea_block_1": {"id": 1087, "summary": "我覺得紙本地圖若沒有像離線 GPS 定位器這樣的設備搭配使用，在海上求生情境下可能無法發揮太大效用。"},
    "idea_block_2": {"id": 1034, "summary": "我覺得離線 GPS 和大西洋紙本地圖在無法確定位置且目標是等待救援的情況下根本用不到。"}
  },
  {
    "id": 66,
    "idea_block_id_1": 1088,
    "idea_block_id_2": 1044,
    "reason": "Both ideas share a compatible ranking stance by prioritizing the fishing rod as a critical food source for survival. The rationale is the same: using the rod to catch fish prevents starvation.",
    "is_same_reason": true,
    "idea_block_1": {"id": 1088, "summary": "我覺得在等待救援的過程中，釣魚竿作為食物來源的潛在價值，可能比剛才討論的那個物品更重要。"},
    "idea_block_2": {"id": 1044, "summary": "我覺得釣魚竿相對有用，因為它可以讓我釣魚吃，確保我不會餓死。"}
  }
]
```
