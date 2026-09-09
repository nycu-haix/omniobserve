from typing import Any

from . import lost_at_sea


TASK_ID = "multimedia-hci-capstone"
TASK_TITLE = "Multimedia and Human Computer Interaction Capstone"
TEMPLATE_DESCRIPTION = "Upload a spreadsheet item list for a capstone ranking discussion."

TOPIC_DESCRIPTION = (
    "Participants discuss and rank a custom item list for the Multimedia and Human Computer Interaction Capstone. "
    "The item list is uploaded by a session participant before ranking begins."
)
TASK_TOPIC_DETAIL = (
    "Upload an Excel-exported CSV/TSV item list, then rank the uploaded items by importance. "
    "Required columns can be simple: item/title/name, and optional description."
)
LLM_TOPIC_DESCRIPTION = TOPIC_DESCRIPTION
SIMILARITY_TASK_CONTEXT = TOPIC_DESCRIPTION
TASK_ITEMS: list[dict[str, Any]] = []
RANKING_ITEMS: list[str] = []
RANKING_ITEM_DISPLAY_NAMES: dict[str, tuple[str, str]] = {}
TASK_PHASES = lost_at_sea.TASK_PHASES

TASK_CONFIG = {
    "task_id": TASK_ID,
    "title": TASK_TITLE,
    "template_description": TEMPLATE_DESCRIPTION,
    "topic_description": TOPIC_DESCRIPTION,
    "task_detail": TASK_TOPIC_DETAIL,
    "phases": TASK_PHASES,
    "items": TASK_ITEMS,
}


def serialize_task_config() -> dict[str, Any]:
    return {
        "task_id": TASK_ID,
        "title": TASK_TITLE,
        "template_description": TEMPLATE_DESCRIPTION,
        "topic_description": TOPIC_DESCRIPTION,
        "task_detail": TASK_TOPIC_DETAIL,
        "phases": TASK_PHASES,
        "items": [],
    }
