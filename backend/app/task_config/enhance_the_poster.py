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
TEMPLATE_DESCRIPTION = "針對淨灘活動招募海報，排序最需要優先改善的 15 個面向。"
REFERENCE_IMAGE_SRC = "/task-assets/beach-cleanup-poster.png"
REFERENCE_IMAGE_ALT = "淨灘活動招募海報"

TOPIC_DESCRIPTION = """你們正在共同檢視一張淨灘活動招募海報。海報目前包含：上半部的淨灘插圖、主標語「一起來淨灘吧!」、日期時間「3/6 15:00」、地點「臺中市南屯區黎明路二段497號」、活動說明「所有用具皆已備妥--只需帶上你的活力與熱情!」，以及底部的報名 QR Code。

你們的任務是：**依照下列改善面向對「提升這張淨灘活動海報的招募效果」的重要性進行排序。**

請將最應該優先改善的面向標為 **1**，第二重要的標為 **2**，依此類推，直到最不需要優先處理的面向標為 **15**。排序時請考慮：路過的人能否快速理解活動內容、是否願意報名、時間地點是否清楚、QR Code 是否容易被注意並掃描、視覺層次是否有效，以及資訊是否足以讓人安心參與。"""

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

### 第一階段：個人排序

請先獨立檢視海報草稿，不要和其他人討論。

根據你自己的判斷，將 15 個改善面向依照優先順序排序。

請注意：

你的目標不是重新設計整張海報，而是判斷**最值得優先投入討論與修改的方向**，讓這張淨灘活動海報更能吸引人報名並降低參與不確定性。

### 第二階段：小組共識排序

完成個人排序後，請和小組成員討論。

你們需要共同產生一份小組排序。小組排序不一定要完全符合任何一位成員的個人排序，但每個成員的意見都應該被聽見。你們需要透過討論、說服、妥協，形成一份大家都能接受的共同排序。

---

# 改善面向清單
{chr(10).join(item["label_zh"] for item in TASK_ITEMS)}
"""

TASK_TOPIC_DETAIL = (
    "你們正在檢視一張淨灘活動招募海報。海報目前包含淨灘插圖、主標語「一起來淨灘吧!」、"
    "日期時間「3/6 15:00」、地點「臺中市南屯區黎明路二段497號」、用品說明與報名 QR Code。"
    "請針對 15 個改善面向排序：第 1 名代表最應該優先改善，第 15 名代表相對最不需要優先處理。"
    "排序時請考慮觀眾能否快速理解活動內容、是否願意報名、時間地點是否清楚、QR Code 是否容易掃描、"
    "視覺層次是否有效，以及資訊是否足以讓人安心參與。"
)

SIMILARITY_TASK_CONTEXT = (
    "參與者正在針對淨灘活動招募海報的 15 個改善面向進行優先順序排序，分析必須基於提升海報招募效果的目標：\n"
    + "- "
    + "、".join(f"{item['label_zh']} ({item['id']})" for item in TASK_ITEMS)
    + "。"
)

TASK_CONFIG = {
    "task_id": TASK_ID,
    "title": TASK_TITLE,
    "template_description": TEMPLATE_DESCRIPTION,
    "topic_description": TOPIC_DESCRIPTION,
    "task_detail": TASK_TOPIC_DETAIL,
    "items": TASK_ITEMS,
    "reference_image_src": REFERENCE_IMAGE_SRC,
    "reference_image_alt": REFERENCE_IMAGE_ALT,
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
