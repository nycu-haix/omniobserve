from typing import Any, TypedDict


class TaskItemConfig(TypedDict):
    id: str
    label_zh: str
    label_en: str
    description_zh: str
    aliases: list[str]
    image_title: str
    image_bg: str
    image_fg: str
    image_mark: str


TASK_ID = "enhance-the-poster"
TASK_TITLE = "Enhance the Poster"
TEMPLATE_DESCRIPTION = "針對淨灘活動招募海報，建立並排序優先改善的 task items。"
REFERENCE_IMAGE_SRC = "/task-assets/enhance-poster-task-brief-page-3.png?v=20260613-main"
REFERENCE_IMAGE_ALT = "2026 NYCU 世界淨灘日南寮海岸淨灘行動海報草稿"
PHASE1_MIN_TASK_ITEMS = 4
RANKING_IMPORTANCE_LIMIT = 15
CUSTOM_DETAIL_ACTION_ID = "custom_detail"
REPLACE_IMAGE_LIBRARY_ACTION_ID = "replace_image_library"
IMAGE_LIBRARY_COMPONENT_IDS = {
    "people_icon1",
    "people_icon2",
    "activity_icon1",
    "activity_icon2",
}

TOPIC_DESCRIPTION = """你們已完成一張淨灘活動招募海報的初稿。為了進一步提升海報品質，我們將目前的設計交給 reviewer 閱讀，並收集了一些關於資訊清楚度、文字內容與視覺呈現的改善建議。請綜合目前的海報內容與 reviewer feedback，討論哪些部分需要調整，讓整體視覺呈現更加完整以及和諧。

每位參與者收到的 Canva 材料包含：初版淨灘活動招募海報、任務說明與任務需求、reviewer feedback 摘要、圖床、可替換的文字與 slogan library，以及海報元件和改善動作的 library。海報目前包含：淨灘插圖、主標語「一起來淨灘吧!」、日期時間「3/6（四）15:00-18:00」、地點、活動說明，以及報名 QR Code。

你們的任務是：**先各自建立最值得優先改善的 task items，再於小組討論時整合成共同優先順序。**

Private Phase 1 請從預設的海報元件與改善動作中組合至少 4 個 task items，沒有數量上限，並依照優先改善順序排列。進入 Private Phase 2 後，所有成員建立的 task items 會集中在一起；Private Phase 2 與 Public Phase 都只需要排序前 15 個最重要的改善項目，排在第 16 個之後的項目表示不會改動。Public Phase 可以開啟公開麥克風與其他人討論，且每位參與者請至少公開發言兩次。

排序時請考慮：路過的人能否快速理解活動內容、是否願意報名、時間地點是否清楚、QR Code 是否容易被注意並掃描、視覺層次是否有效，以及資訊是否足以讓人安心參與。"""

TASK_ITEMS: list[TaskItemConfig] = [
    {
        "id": "mock_main_title_enlarge",
        "label_zh": "放大「主標題」",
        "label_en": "Enlarge the main title",
        "description_zh": "主標題 / 放大",
        "aliases": ["主標題", "標題", "放大", "主標題 放大", "main title", "enlarge"],
        "image_title": "主標題",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "TITLE",
    },
    {
        "id": "mock_main_title_change_color",
        "label_zh": "改「主標題」顏色",
        "label_en": "Change the main title color",
        "description_zh": "主標題 / 改顏色",
        "aliases": ["主標題", "標題", "改顏色", "顏色", "main title", "change color"],
        "image_title": "主標題",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "COLOR",
    },
    {
        "id": "mock_title_group_move",
        "label_zh": "移動「主標題+副標題+說明」",
        "label_en": "Move the title group",
        "description_zh": "主標題+副標題+說明 / 移動",
        "aliases": ["主標題+副標題+說明", "標題組", "移動", "title group", "move"],
        "image_title": "主標題+副標題+說明",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "GROUP",
    },
    {
        "id": "mock_title_group_unify_font",
        "label_zh": "統一「主標題+副標題+說明」字型",
        "label_en": "Unify the title group font",
        "description_zh": "主標題+副標題+說明 / 統一字型",
        "aliases": ["主標題+副標題+說明", "標題組", "統一字型", "字型", "title group", "unify font"],
        "image_title": "主標題+副標題+說明",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "FONT",
    },
    {
        "id": "mock_title_group_left_align",
        "label_zh": "將「主標題+副標題+說明」向左對齊",
        "label_en": "Left-align the title group",
        "description_zh": "主標題+副標題+說明 / 向左對齊",
        "aliases": ["主標題+副標題+說明", "標題組", "向左對齊", "左對齊", "title group", "left align"],
        "image_title": "主標題+副標題+說明",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "LEFT",
    },
    {
        "id": "mock_title_group_center_align",
        "label_zh": "將「主標題+副標題+說明」置中對齊",
        "label_en": "Center-align the title group",
        "description_zh": "主標題+副標題+說明 / 置中對齊",
        "aliases": ["主標題+副標題+說明", "標題組", "置中對齊", "置中", "title group", "center align"],
        "image_title": "主標題+副標題+說明",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "CENTER",
    },
    {
        "id": "mock_description_change_color",
        "label_zh": "改「說明文字」顏色",
        "label_en": "Change the description color",
        "description_zh": "說明文字 / 改顏色",
        "aliases": ["說明文字", "說明", "改顏色", "顏色", "description", "change color"],
        "image_title": "說明文字",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "DESC",
    },
    {
        "id": "mock_qr_code_group_shrink",
        "label_zh": "縮小「QR 碼+說明」",
        "label_en": "Shrink the QR code group",
        "description_zh": "QR 碼+說明 / 縮小",
        "aliases": ["QR 碼+說明", "QR code", "QR", "縮小", "qr code group", "shrink"],
        "image_title": "QR 碼+說明",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "QR",
    },
    {
        "id": "mock_info_group_adjust_spacing",
        "label_zh": "調整「下方資訊」間距",
        "label_en": "Adjust the bottom information spacing",
        "description_zh": "下方資訊 / 調整間距",
        "aliases": ["下方資訊", "底部資訊", "調整間距", "間距", "info group", "spacing"],
        "image_title": "下方資訊",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "SPACE",
    },
    {
        "id": "mock_info_group_move",
        "label_zh": "移動「下方資訊」",
        "label_en": "Move the bottom information",
        "description_zh": "下方資訊 / 移動",
        "aliases": ["下方資訊", "底部資訊", "移動", "info group", "move"],
        "image_title": "下方資訊",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "INFO",
    },
    {
        "id": "mock_info_group_left_align",
        "label_zh": "將「下方資訊」向左對齊",
        "label_en": "Left-align the bottom information",
        "description_zh": "下方資訊 / 向左對齊",
        "aliases": ["下方資訊", "底部資訊", "向左對齊", "左對齊", "info group", "left align"],
        "image_title": "下方資訊",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "LEFT",
    },
    {
        "id": "mock_info_group_enlarge",
        "label_zh": "放大「下方資訊」",
        "label_en": "Enlarge the bottom information",
        "description_zh": "下方資訊 / 放大",
        "aliases": ["下方資訊", "底部資訊", "放大", "info group", "enlarge"],
        "image_title": "下方資訊",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "INFO",
    },
    {
        "id": "mock_date_location_cta_left_align",
        "label_zh": "將「日期時間+地點+行動呼籲」向左對齊",
        "label_en": "Left-align the date, location, and call to action",
        "description_zh": "日期時間+地點+行動呼籲 / 向左對齊",
        "aliases": ["日期時間+地點+行動呼籲", "時間地點行動呼籲", "CTA", "向左對齊", "left align"],
        "image_title": "日期時間+地點+行動呼籲",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "DTC",
    },
    {
        "id": "mock_cta_shrink",
        "label_zh": "縮小「行動呼籲」",
        "label_en": "Shrink the call to action",
        "description_zh": "行動呼籲 / 縮小",
        "aliases": ["行動呼籲", "CTA", "縮小", "call to action", "shrink"],
        "image_title": "行動呼籲",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "CTA",
    },
    {
        "id": "mock_background_move",
        "label_zh": "移動「背景」",
        "label_en": "Move the background",
        "description_zh": "背景 / 移動",
        "aliases": ["背景", "移動", "background", "move"],
        "image_title": "背景",
        "image_bg": "#f8fafc",
        "image_fg": "#334155",
        "image_mark": "BG",
    },
]

PHASE1_POSTER_COMPONENTS = [
    {
        "id": "main_title",
        "label_zh": "主標題",
        "label_en": "Main title",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "subtitle",
        "label_zh": "副標題",
        "label_en": "Subtitle",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "description1",
        "label_zh": "活動說明1",
        "label_en": "Description 1",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "description2",
        "label_zh": "活動說明2",
        "label_en": "Description 2",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "people_icon1",
        "label_zh": "人物圖示1",
        "label_en": "People Icon 1",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", REPLACE_IMAGE_LIBRARY_ACTION_ID, "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "people_icon2",
        "label_zh": "人物圖示2",
        "label_en": "People Icon 2",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", REPLACE_IMAGE_LIBRARY_ACTION_ID, "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "qr_code",
        "label_zh": "QR 碼",
        "label_en": "QR code",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "qr_caption",
        "label_zh": "QR 碼說明",
        "label_en": "QR caption",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "contact_info",
        "label_zh": "參與資訊",
        "label_en": "Participation info",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "organizer_list",
        "label_zh": "主辦單位",
        "label_en": "Organizer list",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "reminder",
        "label_zh": "指導單位",
        "label_en": "Advising organization",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "event_info",
        "label_zh": "響應活動",
        "label_en": "Participating event",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "activity_icon1",
        "label_zh": "活動圖示1",
        "label_en": "Activity Icon 1",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", REPLACE_IMAGE_LIBRARY_ACTION_ID, "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "activity_icon2",
        "label_zh": "活動圖示2",
        "label_en": "Activity Icon 2",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", REPLACE_IMAGE_LIBRARY_ACTION_ID, "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "qr_code_group",
        "label_zh": "QR 碼+說明",
        "label_en": "QR code group",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "adjust_spacing", "unify_color", "align_left", "align_center", "align_right", "spread_out", "assemble", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "title_group",
        "label_zh": "主標題+副標題",
        "label_en": "Title group",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "adjust_spacing", "unify_font", "unify_color", "align_left", "align_center", "align_right", "spread_out", "assemble", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "info_group2",
        "label_zh": "主辦單位+指導單位+響應活動",
        "label_en": "Organizer, advising organization, and participating event group",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "adjust_spacing", "unify_font", "unify_color", "align_left", "align_center", "align_right", "spread_out", "assemble", CUSTOM_DETAIL_ACTION_ID],
    },
    {
        "id": "background",
        "label_zh": "背景",
        "label_en": "Background",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "transparency", CUSTOM_DETAIL_ACTION_ID],
    },
]

PHASE1_ACTION_ITEMS = [
    {
        "id": "remove",
        "label_zh": "去除",
        "label_en": "Remove",
        "template_zh": "去除「{component}」",
    },
    {
        "id": "move",
        "label_zh": "移動",
        "label_en": "Move",
        "template_zh": "移動「{component}」",
    },
    {
        "id": "enlarge",
        "label_zh": "放大",
        "label_en": "Enlarge",
        "template_zh": "放大「{component}」",
    },
    {
        "id": "shrink",
        "label_zh": "縮小",
        "label_en": "Shrink",
        "template_zh": "縮小「{component}」",
    },
    {
        "id": "change_color",
        "label_zh": "改顏色",
        "label_en": "Change color",
        "template_zh": "改「{component}」顏色",
    },
    {
        "id": "change_font",
        "label_zh": "調整字型",
        "label_en": "Change font",
        "template_zh": "調整「{component}」字型",
    },
    {
        "id": "adjust_spacing",
        "label_zh": "調整間距",
        "label_en": "Adjust spacing",
        "template_zh": "調整「{component}」間距",
    },
    {
        "id": "spread_out",
        "label_zh": "分散",
        "label_en": "Spread out",
        "template_zh": "將「{component}」分散",
    },
    {
        "id": "assemble",
        "label_zh": "集合",
        "label_en": "Assemble",
        "template_zh": "將「{component}」集合",
    },
    {
        "id": "unify_font",
        "label_zh": "統一字型",
        "label_en": "Unify font",
        "template_zh": "統一「{component}」字型",
    },
    {
        "id": "unify_color",
        "label_zh": "統一顏色",
        "label_en": "Unify color",
        "template_zh": "統一「{component}」顏色",
    },
    {
        "id": "transparency",
        "label_zh": "調整透明度",
        "label_en": "Adjust transparency",
        "template_zh": "調整「{component}」透明度",
    },
    {
        "id": "align_left",
        "label_zh": "向左對齊",
        "label_en": "Align left",
        "template_zh": "將「{component}」向左對齊",
    },
    {
        "id": "align_right",
        "label_zh": "向右對齊",
        "label_en": "Align right",
        "template_zh": "將「{component}」向右對齊",
    },
    {
        "id": "align_center",
        "label_zh": "置中對齊",
        "label_en": "Align center",
        "template_zh": "將「{component}」置中對齊",
    },
    {
        "id": REPLACE_IMAGE_LIBRARY_ACTION_ID,
        "label_zh": "替換成圖片",
        "label_en": "Replace with image",
        "description_zh": "輸入 Canva 圖片 Library 的編號，將這個圖示替換成指定圖片。",
        "template_zh": "將「{component}」替換成圖片 {detail}",
        "requires_detail": True,
        "detail_input": {
            "kind": "library_number",
            "label_zh": "圖片編號",
            "placeholder_zh": "例如：2",
            "min": 1,
        },
    },
    {
        "id": CUSTOM_DETAIL_ACTION_ID,
        "label_zh": "自訂動作",
        "label_en": "Custom action",
        "description_zh": "用自己的文字描述要怎麼調整這個元件。",
        "template_zh": "「{component}」",
        "requires_detail": True,
    },
]

for component in PHASE1_POSTER_COMPONENTS:
    allowed_action_ids = component.get("allowed_action_ids")
    if not isinstance(allowed_action_ids, list):
        continue
    if component.get("id") in IMAGE_LIBRARY_COMPONENT_IDS and REPLACE_IMAGE_LIBRARY_ACTION_ID not in allowed_action_ids:
        allowed_action_ids.append(REPLACE_IMAGE_LIBRARY_ACTION_ID)
    if CUSTOM_DETAIL_ACTION_ID not in allowed_action_ids:
        allowed_action_ids.append(CUSTOM_DETAIL_ACTION_ID)

PHASE1_BUILDER_CONFIG = {
    "enabled": True,
    "title": "第一階段改善項目",
    "minimum_items": PHASE1_MIN_TASK_ITEMS,
    "components": PHASE1_POSTER_COMPONENTS,
    "actions": PHASE1_ACTION_ITEMS,
}

RANKING_ITEMS = [item["id"] for item in TASK_ITEMS]
RANKING_ITEM_DISPLAY_NAMES = {
    item["id"]: (
        item["label_zh"],
        ", ".join(dict.fromkeys([item["label_en"], *item["aliases"]])),
    )
    for item in TASK_ITEMS
}

LLM_TOPIC_DESCRIPTION = f"""{TOPIC_DESCRIPTION}

## 任務流程

### 第一階段：個人建立 task items

請先獨立檢視海報草稿，不要和其他人討論。

根據你自己的判斷，從預設的海報元件與改善動作中組合出至少 4 個最值得優先改善的 task items。你可以建立超過 4 個，所有項目都會帶到下一階段。

請注意：

你的目標不是重新設計整張海報，而是建立**具體、可討論、可排序的改善項目**，讓這張淨灘活動海報更能吸引人報名並降低參與不確定性。

### 第二階段：小組共識排序

完成個人排序後，請和小組成員討論。

你們需要共同產生一份小組優先改善清單。請只排序前 15 個最重要的改善項目；第 16 個之後代表暫時不會改動。小組清單不一定要完全符合任何一位成員的個人清單，但每個成員的意見都應該被聽見。你們需要透過討論、說服、妥協，形成一份大家都能接受的共同排序。

---

# 預設改善項目清單
{chr(10).join(item["label_zh"] for item in TASK_ITEMS)}
"""

TASK_TOPIC_DETAIL = """每年九月第三個星期六為 International Coastal Cleanup® 世界淨灘日。配合今年的世界淨灘日活動，陽明交大永續發展暨社會責任推動辦公室將主辦「2026 NYCU 世界淨灘日｜南寮海岸淨灘行動」，並由新竹市政府贊助。

想像你剛加入活動宣傳組，目前的任務是協助修改活動宣傳海報。目前你所看到的是主辦單位參考過去相關活動宣傳素材所製作的第一版設計稿。然而，主辦單位認為目前版本在資訊傳達與宣傳效果方面仍有改善空間，因此邀請了五位不同背景的人士提供修改建議。你的任務是閱讀這些回饋意見，並規劃後續的海報修改方向。

在評估各項建議時，請記住最終海報必須同時達成三項目標。第一，清楚傳達活動資訊；第二，提高 NYCU 學生、教職員工的參與意願；第三，維持良好的視覺設計品質，讓海報看起來專業、清楚，並具有活動本身的特色。

這份海報必須要包含以下內容：
- 標題
- 副標題
- Call for action
- 活動日期
- 兩個場次的
    - 時間長度
    - 活動地點
    - 接駁車發車時間與集合地點
- 主辦單位或相關單位資訊
- 至少一張與活動相關的圖片
- 背景不得留白，必須使用背景顏色或背景圖像
- 海報中必須使用 NYCU 藍色作為其中一種視覺元素
- 設計者可自行決定字型、排版方式、圖片使用方式與視覺風格"""

SIMILARITY_TASK_CONTEXT = (
    "參與者正在針對淨灘活動招募海報建立改善項目，並在後續階段排序前 15 個最重要的改善項目。分析必須基於提升海報招募效果的目標：\n"
    + "- "
    + "、".join(f"{item['label_zh']} ({item['id']})" for item in TASK_ITEMS)
    + "。"
)

TASK_INSTRUCTIONS_LAYOUT = {
    "type": "leaf",
    "content": "task-instructions",
}
PHASE1_TASK_ITEM_BUILDER_LAYOUT = {
    "type": "leaf",
    "content": "phase-task-items",
}
PRIVATE_RANKING_LAYOUT = {
    "type": "leaf",
    "content": "private-ranking",
}
PRIVATE_PHASE_1_WITH_INSTRUCTIONS_LAYOUT = {
    "type": "split",
    "direction": "horizontal",
    "ratio": 58,
    "first": PHASE1_TASK_ITEM_BUILDER_LAYOUT,
    "second": TASK_INSTRUCTIONS_LAYOUT,
}
PRIVATE_PHASE_2_WITH_INSTRUCTIONS_LAYOUT = {
    "type": "split",
    "direction": "horizontal",
    "ratio": 58,
    "first": PRIVATE_RANKING_LAYOUT,
    "second": TASK_INSTRUCTIONS_LAYOUT,
}
PUBLIC_RANKING_COMPARISON_LAYOUT = {
    "type": "split",
    "direction": "horizontal",
    "ratio": 50,
    "first": {"type": "leaf", "content": "public-ranking"},
    "second": {"type": "leaf", "content": "private-ranking"},
}

TASK_PHASES = [
    {"id": "private_phase_1", "label": "Private Phase 1", "default_layout": PRIVATE_PHASE_1_WITH_INSTRUCTIONS_LAYOUT},
    {"id": "private_phase_2", "label": "Private Phase 2", "default_layout": PRIVATE_PHASE_2_WITH_INSTRUCTIONS_LAYOUT},
    {"id": "group", "label": "Public Phase", "default_layout": PUBLIC_RANKING_COMPARISON_LAYOUT},
    {"id": "reflect", "label": "Reflect Phase", "default_layout": PRIVATE_RANKING_LAYOUT},
]

TASK_CONFIG = {
    "task_id": TASK_ID,
    "title": TASK_TITLE,
    "template_description": TEMPLATE_DESCRIPTION,
    "topic_description": TOPIC_DESCRIPTION,
    "task_detail": TASK_TOPIC_DETAIL,
    "phases": TASK_PHASES,
    "items": TASK_ITEMS,
    "reference_image_src": REFERENCE_IMAGE_SRC,
    "reference_image_alt": REFERENCE_IMAGE_ALT,
    "phase1_builder": PHASE1_BUILDER_CONFIG,
    "ranking_limit": RANKING_IMPORTANCE_LIMIT,
}


def serialize_task_config() -> dict[str, Any]:
    return {
        "task_id": TASK_ID,
        "title": TASK_TITLE,
        "template_description": TEMPLATE_DESCRIPTION,
        "topic_description": TOPIC_DESCRIPTION,
        "task_detail": TASK_TOPIC_DETAIL,
        "reference_image_src": REFERENCE_IMAGE_SRC,
        "reference_image_alt": REFERENCE_IMAGE_ALT,
        "phases": TASK_PHASES,
        "phase1_builder": PHASE1_BUILDER_CONFIG,
        "ranking_limit": RANKING_IMPORTANCE_LIMIT,
        "items": [
            {
                "id": item["id"],
                "label": item["label_zh"],
                "label_zh": item["label_zh"],
                "label_en": item["label_en"],
                "description_zh": item["description_zh"],
                "aliases": list(item["aliases"]),
                "image_title": item["image_title"],
                "image_bg": item["image_bg"],
                "image_fg": item["image_fg"],
                "image_mark": item["image_mark"],
            }
            for item in TASK_ITEMS
        ],
    }
