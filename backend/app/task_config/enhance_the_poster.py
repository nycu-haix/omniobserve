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
REFERENCE_IMAGE_SRC = "/task-assets/beach-cleanup-poster.png"
REFERENCE_IMAGE_ALT = "淨灘活動招募海報"

TOPIC_DESCRIPTION = """你們正在共同檢視一張淨灘活動招募海報。海報目前包含：上半部的淨灘插圖、主標語「一起來淨灘吧!」、日期時間「3/6 15:00」、地點「臺中市南屯區黎明路二段497號」、活動說明「所有用具皆已備妥--只需帶上你的活力與熱情!」，以及底部的報名 QR Code。

你們的任務是：**先各自建立最值得優先改善的 task items，再於小組討論時整合成共同優先順序。**

Private Phase 1 請從預設的海報元件與改善動作中組合 task item，並依照優先改善順序排列。排序時請考慮：路過的人能否快速理解活動內容、是否願意報名、時間地點是否清楚、QR Code 是否容易被注意並掃描、視覺層次是否有效，以及資訊是否足以讓人安心參與。"""

TASK_ITEMS: list[TaskItemConfig] = [
    {
        "id": "headline_message",
        "label_zh": "主標語與活動主題",
        "label_en": "headline and event theme",
        "description_zh": "改善「一起來淨灘吧!」等主標語，讓活動主題更醒目、更有吸引力。",
        "aliases": ["主標語", "標語", "活動主題", "標題", "headline", "title", "event theme", "slogan"],
        "image_title": "Headline",
        "image_bg": "#ecfeff",
        "image_fg": "#0e7490",
        "image_mark": "TITLE",
    },
    {
        "id": "event_datetime",
        "label_zh": "日期與時間",
        "label_en": "date and time",
        "description_zh": "改善「3/6 15:00」的呈現，讓活動日期、時間與是否需要提前集合更清楚。",
        "aliases": ["日期", "時間", "3/6", "15:00", "活動時間", "date", "time", "schedule"],
        "image_title": "Date Time",
        "image_bg": "#dbeafe",
        "image_fg": "#1d4ed8",
        "image_mark": "TIME",
    },
    {
        "id": "location_address",
        "label_zh": "地點與集合資訊",
        "label_en": "location and meeting point",
        "description_zh": "改善地址與集合點資訊，讓參與者知道去哪裡、如何抵達、是否需要地圖或地標。",
        "aliases": ["地點", "地址", "集合", "集合點", "黎明路", "location", "address", "meeting point", "map"],
        "image_title": "Location",
        "image_bg": "#dcfce7",
        "image_fg": "#15803d",
        "image_mark": "MAP",
    },
    {
        "id": "signup_qr_code",
        "label_zh": "報名 QR Code",
        "label_en": "registration QR code",
        "description_zh": "改善 QR Code 的大小、位置、留白與標示，讓觀眾知道它是報名入口並容易掃描。",
        "aliases": ["QR", "QR Code", "報名碼", "掃碼", "registration QR", "signup QR", "scan"],
        "image_title": "QR Code",
        "image_bg": "#f1f5f9",
        "image_fg": "#475569",
        "image_mark": "QR",
    },
    {
        "id": "call_to_action",
        "label_zh": "報名與行動指引",
        "label_en": "call to action",
        "description_zh": "加入或強化立即報名、掃描 QR Code、截止時間等明確行動指引。",
        "aliases": ["報名", "行動指引", "立即報名", "掃描報名", "CTA", "call to action", "signup", "register"],
        "image_title": "Call To Action",
        "image_bg": "#fef3c7",
        "image_fg": "#b45309",
        "image_mark": "CTA",
    },
    {
        "id": "supplies_notice",
        "label_zh": "用品準備說明",
        "label_en": "supplies and preparation note",
        "description_zh": "改善「所有用具皆已備妥」等說明，讓參與者知道需要帶什麼、不需要帶什麼。",
        "aliases": ["用具", "用品", "準備", "自備", "所有用具", "supplies", "equipment", "preparation"],
        "image_title": "Supplies",
        "image_bg": "#ffedd5",
        "image_fg": "#c2410c",
        "image_mark": "BAG",
    },
    {
        "id": "motivation_value",
        "label_zh": "淨灘動機與價值",
        "label_en": "motivation and value",
        "description_zh": "補強為什麼要參加淨灘，例如環境影響、社群感、活動意義或參與後能帶來的改變。",
        "aliases": ["動機", "價值", "環保", "意義", "為什麼", "motivation", "value", "impact", "environment"],
        "image_title": "Motivation",
        "image_bg": "#ccfbf1",
        "image_fg": "#0f766e",
        "image_mark": "WHY",
    },
    {
        "id": "organizer_contact",
        "label_zh": "主辦與聯絡資訊",
        "label_en": "organizer and contact information",
        "description_zh": "加入或改善主辦單位、聯絡方式、社群帳號等資訊，提升可信度並方便詢問。",
        "aliases": ["主辦", "聯絡", "聯絡資訊", "社群", "organizer", "contact", "host", "social"],
        "image_title": "Contact",
        "image_bg": "#e0f2fe",
        "image_fg": "#075985",
        "image_mark": "INFO",
    },
    {
        "id": "illustration_focus",
        "label_zh": "主視覺插圖",
        "label_en": "main illustration",
        "description_zh": "改善淨灘人物插圖的大小、位置、情緒、與文字資訊之間的關係。",
        "aliases": ["插圖", "圖片", "人物", "主視覺", "illustration", "image", "visual", "people"],
        "image_title": "Illustration",
        "image_bg": "#fae8ff",
        "image_fg": "#a21caf",
        "image_mark": "IMG",
    },
    {
        "id": "visual_hierarchy",
        "label_zh": "視覺層次",
        "label_en": "visual hierarchy",
        "description_zh": "調整資訊優先順序，讓觀眾先看到活動主題，再看到時間地點與報名方式。",
        "aliases": ["視覺層次", "資訊層次", "重點", "hierarchy", "priority", "emphasis"],
        "image_title": "Hierarchy",
        "image_bg": "#ede9fe",
        "image_fg": "#6d28d9",
        "image_mark": "RANK",
    },
    {
        "id": "whitespace_layout",
        "label_zh": "版面留白與對齊",
        "label_en": "spacing and alignment",
        "description_zh": "改善整體留白、上下比例、文字對齊與 QR Code 區域配置，讓版面更平衡。",
        "aliases": ["留白", "對齊", "版面", "排版", "spacing", "alignment", "layout", "balance"],
        "image_title": "Layout",
        "image_bg": "#f5f5f4",
        "image_fg": "#78716c",
        "image_mark": "GRID",
    },
    {
        "id": "typography_readability",
        "label_zh": "字體與可讀性",
        "label_en": "typography and readability",
        "description_zh": "改善字體大小、字重、行距、段落分組，讓文字在遠距離或手機上也容易閱讀。",
        "aliases": ["字體", "字太小", "可讀性", "行距", "typography", "font", "readability", "legibility"],
        "image_title": "Typography",
        "image_bg": "#fce7f3",
        "image_fg": "#be185d",
        "image_mark": "TEXT",
    },
    {
        "id": "color_contrast",
        "label_zh": "色彩與對比",
        "label_en": "color and contrast",
        "description_zh": "改善文字、插圖與背景的色彩對比，讓重點更醒目且符合淨灘活動氣氛。",
        "aliases": ["顏色", "色彩", "對比", "藍色", "contrast", "color", "palette", "background"],
        "image_title": "Color",
        "image_bg": "#ecfccb",
        "image_fg": "#4d7c0f",
        "image_mark": "COLOR",
    },
    {
        "id": "mobile_accessibility",
        "label_zh": "手機閱讀與無障礙",
        "label_en": "mobile readability and accessibility",
        "description_zh": "改善手機截圖、投影、遠距離觀看、色弱或低視力觀眾的閱讀與掃碼體驗。",
        "aliases": ["手機", "無障礙", "可及性", "掃讀", "mobile", "accessibility", "a11y", "responsive"],
        "image_title": "Accessibility",
        "image_bg": "#e5e7eb",
        "image_fg": "#374151",
        "image_mark": "A11Y",
    },
    {
        "id": "safety_weather",
        "label_zh": "注意事項與安全提醒",
        "label_en": "instructions and safety reminders",
        "description_zh": "補充天候、穿著、防曬、飲水、交通或安全注意事項，降低參與者的不確定感。",
        "aliases": ["注意事項", "安全", "天氣", "穿著", "防曬", "instructions", "safety", "weather", "reminder"],
        "image_title": "Safety",
        "image_bg": "#fee2e2",
        "image_fg": "#b91c1c",
        "image_mark": "SAFE",
    },
]

PHASE1_POSTER_COMPONENTS = [
    {
        "id": "main_title",
        "label_zh": "主標題",
        "label_en": "Main title",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "subtitle",
        "label_zh": "副標題",
        "label_en": "Subtitle",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "description",
        "label_zh": "說明文字",
        "label_en": "Description",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "date",
        "label_zh": "日期時間",
        "label_en": "Date & Time",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "location",
        "label_zh": "地點",
        "label_en": "Location",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "cta",
        "label_zh": "行動呼籲",
        "label_en": "CTA",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "qr_code",
        "label_zh": "QR 碼",
        "label_en": "QR code", 
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "transparency"],
    },
    {
        "id": "qr_caption",
        "label_zh": "QR 碼說明",
        "label_en": "QR caption",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "organizer_list",
        "label_zh": "協辦單位",
        "label_en": "Organizer list",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "reminder",
        "label_zh": "注意事項",
        "label_en": "Reminder",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "contact_info",
        "label_zh": "聯絡資訊",
        "label_en": "Contact info",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "change_color", "change_font", "transparency"],
    },
    {
        "id": "icon",
        "label_zh": "圖示",
        "label_en": "Icon",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "replace1", "replace2", "transparency"],
    },
    {
        "id": "qr_code_group",
        "label_zh": "QR 碼+說明",
        "label_en": "QR code group",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "adjust_spacing"]
    },
    {
        "id": "title_group",
        "label_zh": "主標題+副標題+說明文字",
        "label_en": "Title group",
        "allowed_action_ids": ["remove", "move", "enlarge", "shrink", "adjust_spacing", "unify"],
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
        "id": "replace1",
        "label_zh": "替換成圖示1",
        "label_en": "Replace1",
        "template_zh": "「{component}」替換成圖示1",
    },
    {
        "id": "replace2",
        "label_zh": "替換成圖示2",
        "label_en": "Replace2",
        "template_zh": "「{component}」替換成圖示2",
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
        "id": "unify",
        "label_zh": "統一字型/顏色",
        "label_en": "Unify",
        "template_zh": "統一「{component}」字型/顏色",
    },
    {
        "id": "transparency",
        "label_zh": "調整透明度",
        "label_en": "Adjust transparency",
        "template_zh": "調整「{component}」透明度",
    },
]

PHASE1_BUILDER_CONFIG = {
    "enabled": True,
    "title": "第一階段改善項目",
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

根據你自己的判斷，從預設的海報元件與改善動作中組合出最值得優先改善的 task items，並依照優先順序排列。

請注意：

你的目標不是重新設計整張海報，而是建立**具體、可討論、可排序的改善項目**，讓這張淨灘活動海報更能吸引人報名並降低參與不確定性。

### 第二階段：小組共識排序

完成個人排序後，請和小組成員討論。

你們需要共同產生一份小組優先改善清單。小組清單不一定要完全符合任何一位成員的個人清單，但每個成員的意見都應該被聽見。你們需要透過討論、說服、妥協，形成一份大家都能接受的共同排序。

---

# 改善面向清單
{chr(10).join(item["label_zh"] for item in TASK_ITEMS)}
"""

TASK_TOPIC_DETAIL = (
    "你們正在檢視一張淨灘活動招募海報。海報目前包含淨灘插圖、主標語「一起來淨灘吧!」、"
    "日期時間「3/6 15:00」、地點「臺中市南屯區黎明路二段497號」、用品說明與報名 QR Code。"
    "Private Phase 1 請從預設的海報元件與改善動作中建立具體 task items，並將最應該優先改善的項目排在前面。"
    "建立 task item 時請考慮觀眾能否快速理解活動內容、是否願意報名、時間地點是否清楚、QR Code 是否容易掃描、"
    "視覺層次是否有效，以及資訊是否足以讓人安心參與。"
)

SIMILARITY_TASK_CONTEXT = (
    "參與者正在針對淨灘活動招募海報的 15 個改善面向進行優先順序排序，分析必須基於提升海報招募效果的目標：\n"
    + "- "
    + "、".join(f"{item['label_zh']} ({item['id']})" for item in TASK_ITEMS)
    + "。"
)

PHASE1_TASK_ITEM_BUILDER_LAYOUT = {
    "type": "split",
    "direction": "horizontal",
    "ratio": 58,
    "first": {"type": "leaf", "content": "phase-task-items"},
    "second": {"type": "leaf", "content": "task-instructions"},
}
PRIVATE_RANKING_LAYOUT = {
    "type": "leaf",
    "content": "private-ranking",
}
PRIVATE_RANKING_WITH_INSTRUCTIONS_LAYOUT = {
    "type": "split",
    "direction": "horizontal",
    "ratio": 58,
    "first": {"type": "leaf", "content": "private-ranking"},
    "second": {"type": "leaf", "content": "task-instructions"},
}
PUBLIC_RANKING_COMPARISON_LAYOUT = {
    "type": "split",
    "direction": "horizontal",
    "ratio": 50,
    "first": {"type": "leaf", "content": "public-ranking"},
    "second": {"type": "leaf", "content": "private-ranking"},
}

TASK_PHASES = [
    {"id": "private_phase_1", "label": "Private Phase 1", "default_layout": PHASE1_TASK_ITEM_BUILDER_LAYOUT},
    {"id": "private_phase_2", "label": "Private Phase 2", "default_layout": PRIVATE_RANKING_WITH_INSTRUCTIONS_LAYOUT},
    {"id": "group", "label": "Public Phase", "default_layout": PUBLIC_RANKING_COMPARISON_LAYOUT},
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
