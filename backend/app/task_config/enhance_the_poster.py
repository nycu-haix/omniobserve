from typing import Any, TypedDict


TASK_ID = "enhance-the-poster"
TASK_TITLE = "Enhance The Poster"
MAX_PRIVATE_TASK_ITEMS = 4


class PosterOption(TypedDict):
    id: str
    label_zh: str
    label_en: str


POSTER_COMPONENTS: list[PosterOption] = [
    {"id": "title", "label_zh": "標題", "label_en": "Title"},
    {"id": "subtitle", "label_zh": "副標題", "label_en": "Subtitle"},
    {"id": "body_text", "label_zh": "說明文字", "label_en": "Body text"},
    {"id": "image", "label_zh": "圖片", "label_en": "Image"},
    {"id": "icon", "label_zh": "圖示", "label_en": "Icon"},
    {"id": "call_to_action", "label_zh": "行動呼籲", "label_en": "Call to action"},
    {"id": "layout", "label_zh": "版面配置", "label_en": "Layout"},
    {"id": "color", "label_zh": "色彩", "label_en": "Color"},
]

ACTIONS: list[PosterOption] = [
    {"id": "add", "label_zh": "新增", "label_en": "Add"},
    {"id": "remove", "label_zh": "移除", "label_en": "Remove"},
    {"id": "edit", "label_zh": "修改", "label_en": "Edit"},
]

ADVANCED_ACTIONS: list[PosterOption] = [
    {"id": "enlarge", "label_zh": "放大", "label_en": "Enlarge"},
    {"id": "shrink", "label_zh": "縮小", "label_en": "Shrink"},
    {"id": "reposition", "label_zh": "重新定位", "label_en": "Reposition"},
    {"id": "rewrite", "label_zh": "改寫", "label_en": "Rewrite"},
    {"id": "change_color", "label_zh": "變更顏色", "label_en": "Change color"},
    {"id": "change_font", "label_zh": "變更字體", "label_en": "Change font"},
    {"id": "replace", "label_zh": "替換", "label_en": "Replace"},
]

POSTER_COMPONENT_IDS = frozenset(option["id"] for option in POSTER_COMPONENTS)
ACTION_IDS = frozenset(option["id"] for option in ACTIONS)
ADVANCED_ACTION_IDS = frozenset(option["id"] for option in ADVANCED_ACTIONS)


def serialize_enhance_the_poster_config() -> dict[str, Any]:
    return {
        "task_id": TASK_ID,
        "title": TASK_TITLE,
        "max_private_task_items": MAX_PRIVATE_TASK_ITEMS,
        "poster_components": [dict(option) for option in POSTER_COMPONENTS],
        "actions": [dict(option) for option in ACTIONS],
        "advanced_actions": [dict(option) for option in ADVANCED_ACTIONS],
    }
