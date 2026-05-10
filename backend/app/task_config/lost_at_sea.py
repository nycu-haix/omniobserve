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


TASK_ID = "lost-at-sea"
TASK_TITLE = "Lost at Sea"

TOPIC_DESCRIPTION = """你們搭乘一艘私人遊艇，在南太平洋上漂流。因為一場原因不明的火災，遊艇和船上大部分物品都被燒毀，遊艇正在慢慢下沉。

由於重要的導航設備被破壞，而且大家在滅火時分心，你們無法確定目前位置。你們目前最好的估計是：距離最近的陸地約 1,600 公里，而且大約位在該陸地的南南西方。

在遊艇完全沉沒前，你們成功救出一艘可用的橡皮救生艇和船槳，救生艇足以載下所有人和下列 15 項物品。所有人生還者口袋裡的東西合計只有：一包香菸、幾盒火柴，以及五張 1 美元紙鈔。

下列 15 項物品都沒有受損，可以正常使用。這些物品不能連上網路，也不能直接呼叫救援；請根據它們在海上求生時的實際用途排序。

你們的任務是：**依照這些物品對「海上求生」的重要性進行排序。**

請將最重要的物品標為 **1**，第二重要的標為 **2**，依此類推，直到最不重要的物品標為 **15**。"""

TASK_ITEMS: list[TaskItemConfig] = [
    {
        "id": "sextant",
        "label_zh": "六分儀",
        "label_en": "sextant",
        "description_zh": "航海上用來測量天體或地平線角度的儀器。",
        "aliases": [
            "六分儀",
            "sextant",
        ],
        "image_title": "Sextant",
        "image_bg": "#fef3c7",
        "image_fg": "#b45309",
        "image_mark": "SEXT",
    },
    {
        "id": "shaving_mirror",
        "label_zh": "刮鬍鏡／小鏡子",
        "label_en": "shaving mirror, small mirror",
        "description_zh": "小型鏡子，通常用來刮鬍子或整理儀容。",
        "aliases": ["刮鬍鏡", "小鏡子", "鏡子", "shaving mirror", "small mirror", "mirror"],
        "image_title": "Shaving Mirror",
        "image_bg": "#f1f5f9",
        "image_fg": "#475569",
        "image_mark": "MIR",
    },
    {
        "id": "water_container",
        "label_zh": "20L 飲用水",
        "label_en": "20L drinking water",
        "description_zh": "一桶可飲用的淡水，容量約 20L。",
        "aliases": ["飲用水", "淡水", "水", "water", "drinking water", "five-gallon can of water"],
        "image_title": "Drinking Water",
        "image_bg": "#dbeafe",
        "image_fg": "#1d4ed8",
        "image_mark": "H2O",
    },
    {
        "id": "mosquito_net",
        "label_zh": "蚊帳",
        "label_en": "mosquito netting",
        "description_zh": "掛在睡覺區域外的細網布，通常用來防蚊蟲。",
        "aliases": ["蚊帳", "mosquito net", "mosquito netting"],
        "image_title": "Mosquito Net",
        "image_bg": "#e0f2fe",
        "image_fg": "#0369a1",
        "image_mark": "NET",
    },
    {
        "id": "emergency_rations",
        "label_zh": "一箱緊急口糧",
        "label_en": "one case of U.S. Army C rations",
        "description_zh": "可長時間保存的軍用罐裝或包裝食品。",
        "aliases": ["一箱緊急口糧", "一箱 C 口糧", "美軍 C 口糧", "軍用口糧", "口糧", "緊急糧食", "C rations", "Army C rations", "emergency rations"],
        "image_title": "C Rations",
        "image_bg": "#ffedd5",
        "image_fg": "#c2410c",
        "image_mark": "FOOD",
    },
    {
        "id": "sea_chart",
        "label_zh": "太平洋地圖",
        "label_en": "maps of the Pacific Ocean",
        "description_zh": "紙本海圖，標示太平洋海域與島嶼位置。",
        "aliases": ["太平洋地圖", "紙本地圖", "海圖", "地圖", "Pacific maps", "maps of the Pacific Ocean", "sea chart", "map"],
        "image_title": "Pacific Map",
        "image_bg": "#ccfbf1",
        "image_fg": "#0f766e",
        "image_mark": "MAP",
    },
    {
        "id": "floating_cushion",
        "label_zh": "救生坐墊",
        "label_en": "seat cushion, flotation device",
        "description_zh": "可漂浮的方形坐墊，通常作為船上安全裝備。",
        "aliases": ["救生坐墊", "漂浮坐墊", "可漂浮的坐墊", "seat cushion", "floating cushion", "flotation device"],
        "image_title": "Floating Cushion",
        "image_bg": "#fce7f3",
        "image_fg": "#be185d",
        "image_mark": "FLOAT",
    },
    {
        "id": "petrol",
        "label_zh": "8L 油氣混合燃料",
        "label_en": "8L oil-gas mix",
        "description_zh": "汽油與機油混合的燃料，通常供小型引擎使用。",
        "aliases": ["油氣混合燃料", "燃料", "汽油", "油", "oil-gas mixture", "oil gas mixture", "petrol", "gasoline", "fuel"],
        "image_title": "Oil-Gas Mixture",
        "image_bg": "#fee2e2",
        "image_fg": "#b91c1c",
        "image_mark": "FUEL",
    },
    {
        "id": "receive_only_radio",
        "label_zh": "電晶體收音機",
        "label_en": "transistor radio, receive-only",
        "description_zh": "小型收音機，通常用來接收廣播。",
        "aliases": [
            "電晶體收音機",
            "小型電晶體收音機",
            "小型收音機",
            "收音機",
            "只能接收不能發送",
            "無線電",
            "receive-only radio",
            "radio receiver",
            "transistor radio",
            "small transistor radio",
        ],
        "image_title": "Radio Receiver",
        "image_bg": "#d1fae5",
        "image_fg": "#047857",
        "image_mark": "RADIO",
    },
    {
        "id": "shark_repellent",
        "label_zh": "防鯊劑",
        "label_en": "shark repellent",
        "description_zh": "標示為可驅避鯊魚的罐裝或包裝用品。",
        "aliases": ["防鯊劑", "防鯊噴劑", "驅鯊劑", "shark repellent", "shark repellent spray"],
        "image_title": "Shark Repellent",
        "image_bg": "#e5e7eb",
        "image_fg": "#374151",
        "image_mark": "SHARK",
    },
    {
        "id": "waterproof_sheet",
        "label_zh": "2m² 不透明塑膠布",
        "label_en": "2m² opaque plastic sheet",
        "description_zh": "不透明、防水的塑膠布，面積約 2m²。",
        "aliases": ["不透明塑膠布", "塑膠布", "防水塑膠布", "opaque plastic", "plastic sheeting", "waterproof sheet", "tarpaulin"],
        "image_title": "Opaque Plastic",
        "image_bg": "#dcfce7",
        "image_fg": "#15803d",
        "image_mark": "SHEET",
    },
    {
        "id": "rum",
        "label_zh": "1L 80% 蘭姆酒",
        "label_en": "1L 80% Puerto Rican rum",
        "description_zh": "酒精濃度約 80% 的蘭姆酒，容量約 1L。",
        "aliases": [
            "波多黎各蘭姆酒",
            "80% 蘭姆酒",
            "蘭姆酒",
            "蘭姆",
            "酒",
            "消毒酒精",
            "高濃度酒精",
            "medical alcohol",
            "high-proof alcohol",
            "disinfectant alcohol",
            "rum",
            "160-proof Puerto Rican rum",
        ],
        "image_title": "Puerto Rican Rum",
        "image_bg": "#fef9c3",
        "image_fg": "#a16207",
        "image_mark": "RUM",
    },
    {
        "id": "rope",
        "label_zh": "5m 尼龍繩",
        "label_en": "5m nylon rope",
        "description_zh": "尼龍材質的繩子，長度約 5m。",
        "aliases": ["尼龍繩", "繩子", "rope", "nylon rope", "fifteen feet of nylon rope"],
        "image_title": "Nylon Rope",
        "image_bg": "#f5f5f4",
        "image_fg": "#78716c",
        "image_mark": "ROPE",
    },
    {
        "id": "chocolate_bars",
        "label_zh": "兩盒巧克力棒",
        "label_en": "two boxes of chocolate bars",
        "description_zh": "兩盒一般巧克力棒。",
        "aliases": ["巧克力棒", "巧克力", "chocolate bars", "two boxes of chocolate bars"],
        "image_title": "Chocolate Bars",
        "image_bg": "#ede9fe",
        "image_fg": "#6d28d9",
        "image_mark": "CHOC",
    },
    {
        "id": "fishing_rod",
        "label_zh": "釣魚工具組",
        "label_en": "fishing kit",
        "description_zh": "包含魚線、魚鉤等用品的釣魚工具組。",
        "aliases": ["釣魚工具組", "釣具", "釣魚竿", "fishing kit", "fishing rod"],
        "image_title": "Fishing Kit",
        "image_bg": "#e0f2fe",
        "image_fg": "#075985",
        "image_mark": "FISH",
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

你的目標不是航行到陸地，而是**在海上提高生存機率**。

### 第二階段：小組共識排序

完成個人排序後，請和小組成員討論。

你們需要共同產生一份小組排序。

小組排序不一定要完全符合任何一位成員的個人排序，但每個成員的意見都應該被聽見。你們需要透過討論、說服、妥協，形成一份大家都能接受的共同排序。

---

# 物品清單
{chr(10).join(item["label_zh"] for item in TASK_ITEMS)}

"""

TASK_TOPIC_DETAIL = (
    "你們搭乘私人遊艇在南太平洋上漂流。原因不明的火災使遊艇受損下沉，導航設備也被破壞；"
    "你們的位置不明，只能估計距離最近陸地約 1,600 公里。"
    "你們有橡皮救生艇、船槳、火柴、香菸、五張 1 美元紙鈔，以及 15 項可用物品。"
    "這些物品不能連上網路，也不能直接呼叫救援。"
    "請根據物品對存活的重要程度排序，將最重要的物品排在第 1 名，最不重要的物品排在第 15 名。"
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
