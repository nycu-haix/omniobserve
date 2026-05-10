from typing import Any, TypedDict


class TaskItemConfig(TypedDict):
    id: str
    label_zh: str
    label_en: str
    aliases: list[str]
    image_title: str
    image_bg: str
    image_fg: str
    image_mark: str


TASK_ID = "lost-at-sea"
TASK_TITLE = "Lost at Sea"

TOPIC_DESCRIPTION = """你和幾位朋友租了一艘遊艇，準備橫越大西洋，進行一次難得的海上旅程。由於你們都沒有足夠的航海經驗，因此船上有一位經驗豐富的船長，以及兩位船員協助航行。

不幸的是，在航行到大西洋中央時，船上的廚房突然發生嚴重火災。船長與船員在試圖滅火的過程中失蹤，遊艇也受到嚴重損壞，正在慢慢下沉。

火災也破壞了重要的導航與通訊設備，因此你們無法準確知道目前的位置。你們只能大致估計：自己距離最近的陸地還有數百英里。

在遊艇完全沉沒前，你們成功救出一艘橡皮救生艇、一盒火柴，以及下列 15 項物品。這些物品都沒有受損，可以正常使用。
這些物品不能連上網路，也不能直接呼叫救援；請根據它們在海上等待救援時的實際用途排序。

你們的任務是：**依照這些物品對「等待救援並存活下來」的重要性進行排序。**

請將最重要的物品標為 **1**，第二重要的標為 **2**，依此類推，直到最不重要的物品標為 **15**。"""

TASK_ITEMS: list[TaskItemConfig] = [
    {
        "id": "mosquito_net",
        "label_zh": "蚊帳",
        "label_en": "mosquito net",
        "aliases": ["mosquito net"],
        "image_title": "Mosquito Net",
        "image_bg": "#e0f2fe",
        "image_fg": "#0369a1",
        "image_mark": "NET",
    },
    {
        "id": "petrol",
        "label_zh": "一罐汽油",
        "label_en": "petrol, gasoline",
        "aliases": ["petrol", "gasoline"],
        "image_title": "Petrol",
        "image_bg": "#fee2e2",
        "image_fg": "#b91c1c",
        "image_mark": "FUEL",
    },
    {
        "id": "water_container",
        "label_zh": "裝水容器",
        "label_en": "water container",
        "aliases": ["water container"],
        "image_title": "Water Container",
        "image_bg": "#dbeafe",
        "image_fg": "#1d4ed8",
        "image_mark": "H2O",
    },
    {
        "id": "shaving_mirror",
        "label_zh": "刮鬍鏡／小鏡子",
        "label_en": "shaving mirror, small mirror",
        "aliases": ["shaving mirror", "small mirror"],
        "image_title": "Shaving Mirror",
        "image_bg": "#f1f5f9",
        "image_fg": "#475569",
        "image_mark": "MIR",
    },
    {
        "id": "offline_gps_receiver",
        "label_zh": "離線 GPS 定位器",
        "label_en": "offline GPS receiver, shows coordinates once, no communication",
        "aliases": [
            "離線 GPS 定位器",
            "離線定位器",
            "定位器",
            "經緯度",
            "六分儀",
            "offline GPS receiver",
            "GPS receiver",
            "coordinates display",
            "sextant",
        ],
        "image_title": "Offline GPS",
        "image_bg": "#fef3c7",
        "image_fg": "#b45309",
        "image_mark": "GPS",
    },
    {
        "id": "emergency_rations",
        "label_zh": "緊急糧食",
        "label_en": "emergency rations",
        "aliases": ["emergency rations"],
        "image_title": "Emergency Rations",
        "image_bg": "#ffedd5",
        "image_fg": "#c2410c",
        "image_mark": "FOOD",
    },
    {
        "id": "atlantic_paper_map",
        "label_zh": "大西洋紙本地圖",
        "label_en": "Atlantic paper map, does not show current location",
        "aliases": [
            "大西洋地圖",
            "紙本地圖",
            "海圖",
            "地圖",
            "Atlantic paper map",
            "paper map",
            "sea chart",
            "map",
        ],
        "image_title": "Paper Map",
        "image_bg": "#ccfbf1",
        "image_fg": "#0f766e",
        "image_mark": "MAP",
    },
    {
        "id": "floating_cushion",
        "label_zh": "可漂浮的坐墊",
        "label_en": "floating cushion",
        "aliases": ["floating cushion"],
        "image_title": "Floating Cushion",
        "image_bg": "#fce7f3",
        "image_fg": "#be185d",
        "image_mark": "FLOAT",
    },
    {
        "id": "rope",
        "label_zh": "繩子",
        "label_en": "rope",
        "aliases": ["rope"],
        "image_title": "Rope",
        "image_bg": "#f5f5f4",
        "image_fg": "#78716c",
        "image_mark": "ROPE",
    },
    {
        "id": "chocolate_bars",
        "label_zh": "巧克力棒",
        "label_en": "chocolate bars",
        "aliases": ["chocolate bars"],
        "image_title": "Chocolate Bars",
        "image_bg": "#ede9fe",
        "image_fg": "#6d28d9",
        "image_mark": "CHOC",
    },
    {
        "id": "waterproof_sheet",
        "label_zh": "防水塑膠布",
        "label_en": "waterproof sheet, tarpaulin",
        "aliases": ["waterproof sheet", "tarpaulin"],
        "image_title": "Waterproof Sheet",
        "image_bg": "#dcfce7",
        "image_fg": "#15803d",
        "image_mark": "SHEET",
    },
    {
        "id": "fishing_rod",
        "label_zh": "釣魚竿",
        "label_en": "fishing rod",
        "aliases": ["fishing rod"],
        "image_title": "Fishing Rod",
        "image_bg": "#e0f2fe",
        "image_fg": "#075985",
        "image_mark": "ROD",
    },
    {
        "id": "shark_repellent",
        "label_zh": "防鯊噴劑",
        "label_en": "shark repellent spray",
        "aliases": ["防鯊噴劑", "驅鯊劑", "shark repellent", "shark repellent spray"],
        "image_title": "Shark Spray",
        "image_bg": "#e5e7eb",
        "image_fg": "#374151",
        "image_mark": "SPRAY",
    },
    {
        "id": "rum",
        "label_zh": "蘭姆酒",
        "label_en": "rum",
        "aliases": [
            "蘭姆酒",
            "蘭姆",
            "酒",
            "消毒酒精",
            "高濃度酒精",
            "medical alcohol",
            "high-proof alcohol",
            "disinfectant alcohol",
            "rum",
        ],
        "image_title": "Rum",
        "image_bg": "#fef9c3",
        "image_fg": "#a16207",
        "image_mark": "RUM",
    },
    {
        "id": "receive_only_radio",
        "label_zh": "小型收音機",
        "label_en": "receive-only radio, cannot transmit",
        "aliases": [
            "小型收音機",
            "收音機",
            "無線電",
            "VHF 無線電",
            "receive-only radio",
            "radio receiver",
            "transistor radio",
            "VHF radio",
        ],
        "image_title": "Radio Receiver",
        "image_bg": "#d1fae5",
        "image_fg": "#047857",
        "image_mark": "RADIO",
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

請先獨立思考，不要和其他人討論。

根據你自己的判斷，將 15 項物品依照重要性排序。

請注意：

你的目標不是航行到陸地，而是**在海上等待救援並提高生存機率**。

### 第二階段：小組共識排序

完成個人排序後，請和小組成員討論。

你們需要共同產生一份小組排序。

小組排序不一定要完全符合任何一位成員的個人排序，但每個成員的意見都應該被聽見。你們需要透過討論、說服、妥協，形成一份大家都能接受的共同排序。

---

# 物品清單
{chr(10).join(item["label_zh"] for item in TASK_ITEMS)}

"""

TASK_TOPIC_DETAIL = (
    "你和幾位朋友租了一艘遊艇，準備橫越大西洋。船上火災使遊艇受損下沉，導航與通訊設備也失效；"
    "你們只能帶著橡皮救生艇、一盒火柴，以及 15 項可用物品在海上等待救援。"
    "這些物品不能連上網路，也不能直接呼叫救援。"
    "請根據物品對存活與等待救援的重要程度排序，將最重要的物品排在第 1 名，最不重要的物品排在第 15 名。"
)

SIMILARITY_TASK_CONTEXT = (
    "參與者正在針對 15 項工具進行排序，分析必須基於海上漂流情境：\n"
    + "- "
    + "、".join(f"{item['label_zh']} ({item['id']})" for item in TASK_ITEMS)
    + "。"
)

TASK_CONFIG = {
    "task_id": TASK_ID,
    "title": TASK_TITLE,
    "topic_description": TOPIC_DESCRIPTION,
    "task_detail": TASK_TOPIC_DETAIL,
    "items": TASK_ITEMS,
}


def serialize_task_config() -> dict[str, Any]:
    return {
        "task_id": TASK_ID,
        "title": TASK_TITLE,
        "topic_description": TOPIC_DESCRIPTION,
        "task_detail": TASK_TOPIC_DETAIL,
        "items": [
            {
                "id": item["id"],
                "label": item["label_zh"],
                "label_zh": item["label_zh"],
                "label_en": item["label_en"],
                "aliases": list(item["aliases"]),
                "image_title": item["image_title"],
                "image_bg": item["image_bg"],
                "image_fg": item["image_fg"],
                "image_mark": item["image_mark"],
            }
            for item in TASK_ITEMS
        ],
    }
