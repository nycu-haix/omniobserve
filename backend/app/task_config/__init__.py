from typing import Any

from . import enhance_the_poster, lost_at_sea

DEFAULT_TASK_ID = lost_at_sea.TASK_ID
TASK_MODULES = (lost_at_sea, enhance_the_poster)
TASK_CONFIGS = {module.TASK_ID: module.TASK_CONFIG for module in TASK_MODULES}
DEFAULT_TASK_PHASES = lost_at_sea.TASK_PHASES

# Backward-compatible exports for call sites that still expect the original default task.
LLM_TOPIC_DESCRIPTION = lost_at_sea.LLM_TOPIC_DESCRIPTION
RANKING_ITEM_DISPLAY_NAMES = lost_at_sea.RANKING_ITEM_DISPLAY_NAMES
RANKING_ITEMS = lost_at_sea.RANKING_ITEMS
SIMILARITY_TASK_CONTEXT = lost_at_sea.SIMILARITY_TASK_CONTEXT
TASK_CONFIG = lost_at_sea.TASK_CONFIG
TASK_ID = lost_at_sea.TASK_ID
TASK_TITLE = lost_at_sea.TASK_TITLE
TASK_TOPIC_DETAIL = lost_at_sea.TASK_TOPIC_DETAIL
TOPIC_DESCRIPTION = lost_at_sea.TOPIC_DESCRIPTION


def resolve_task_id(session_name: str | None = None, task_id: str | None = None) -> str:
    normalized_task_id = (task_id or "").strip().lower()
    if normalized_task_id in TASK_CONFIGS:
        return normalized_task_id

    normalized_session = (session_name or "").strip().lower()
    for known_task_id in TASK_CONFIGS:
        if normalized_session == known_task_id or normalized_session.startswith(f"{known_task_id}-"):
            return known_task_id

    return DEFAULT_TASK_ID


def get_task_module(session_name: str | None = None, task_id: str | None = None) -> Any:
    resolved_task_id = resolve_task_id(session_name=session_name, task_id=task_id)
    for module in TASK_MODULES:
        if module.TASK_ID == resolved_task_id:
            return module
    return lost_at_sea


def get_task_config_for_session(session_name: str | None = None, task_id: str | None = None) -> dict[str, Any]:
    return get_task_module(session_name=session_name, task_id=task_id).TASK_CONFIG


def get_task_phases_for_session(session_name: str | None = None, task_id: str | None = None) -> list[dict[str, Any]]:
    phases = get_task_module(session_name=session_name, task_id=task_id).TASK_CONFIG.get("phases") or DEFAULT_TASK_PHASES
    serialized_phases: list[dict[str, Any]] = []
    for phase in phases:
        serialized_phase = {"id": str(phase["id"]), "label": str(phase["label"])}
        if phase.get("default_layout"):
            serialized_phase["default_layout"] = phase["default_layout"]
        serialized_phases.append(serialized_phase)
    return serialized_phases


def get_default_phase_for_session(session_name: str | None = None, task_id: str | None = None) -> str:
    phases = get_task_phases_for_session(session_name=session_name, task_id=task_id)
    return phases[0]["id"] if phases else "private"


def _normalize_phase_value(value: Any) -> str:
    phase = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    while "__" in phase:
        phase = phase.replace("__", "_")
    return phase


def normalize_phase_for_session(session_name: str | None = None, task_id: str | None = None, phase: Any = None) -> str:
    phases = get_task_phases_for_session(session_name=session_name, task_id=task_id)
    phase_ids = {item["id"] for item in phases}
    default_phase = phases[0]["id"] if phases else "private"
    normalized_phase = _normalize_phase_value(phase)
    if not normalized_phase:
        return default_phase

    phase_aliases = {
        "public": "group",
        "public_phase": "group",
        "group_phase": "group",
        "reflection": "reflect",
        "reflection_phase": "reflect",
        "reflect_phase": "reflect",
        "private_1": "private_phase_1",
        "private_phase_one": "private_phase_1",
        "private_2": "private_phase_2",
        "private_phase_two": "private_phase_2",
    }
    candidate = phase_aliases.get(normalized_phase, normalized_phase)
    if candidate in phase_ids:
        return candidate
    if normalized_phase == "private" and "private_phase_1" in phase_ids:
        return "private_phase_1"
    return default_phase


def get_ranking_items_for_session(session_name: str | None = None, task_id: str | None = None) -> list[str]:
    return list(get_task_module(session_name=session_name, task_id=task_id).RANKING_ITEMS)


def get_ranking_limit_for_session(session_name: str | None = None, task_id: str | None = None) -> int | None:
    value = get_task_config_for_session(session_name=session_name, task_id=task_id).get("ranking_limit")
    try:
        ranking_limit = int(value)
    except (TypeError, ValueError):
        return None
    return ranking_limit if ranking_limit > 0 else None


def get_ranking_item_display_names_for_session(session_name: str | None = None, task_id: str | None = None) -> dict[str, tuple[str, str]]:
    return dict(get_task_module(session_name=session_name, task_id=task_id).RANKING_ITEM_DISPLAY_NAMES)


def get_llm_topic_description_for_session(session_name: str | None = None, task_id: str | None = None) -> str:
    return str(get_task_module(session_name=session_name, task_id=task_id).LLM_TOPIC_DESCRIPTION)


def get_similarity_task_context_for_session(session_name: str | None = None, task_id: str | None = None) -> str:
    return str(get_task_module(session_name=session_name, task_id=task_id).SIMILARITY_TASK_CONTEXT)


def serialize_task_config(session_name: str | None = None, task_id: str | None = None) -> dict[str, Any]:
    module = get_task_module(session_name=session_name, task_id=task_id)
    config = module.TASK_CONFIG
    payload: dict[str, Any] = {
        "task_id": module.TASK_ID,
        "title": module.TASK_TITLE,
        "template_description": config.get("template_description"),
        "topic_description": module.TOPIC_DESCRIPTION,
        "task_detail": module.TASK_TOPIC_DETAIL,
        "phases": get_task_phases_for_session(task_id=module.TASK_ID),
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
            for item in config["items"]
        ],
    }
    if config.get("ranking_limit"):
        payload["ranking_limit"] = config["ranking_limit"]
    if config.get("reference_image_src"):
        payload["reference_image_src"] = config["reference_image_src"]
    if config.get("reference_image_alt"):
        payload["reference_image_alt"] = config["reference_image_alt"]
    if config.get("phase1_builder"):
        payload["phase1_builder"] = config["phase1_builder"]
    return payload


def serialize_task_templates() -> list[dict[str, Any]]:
    return [
        {
            "task_id": module.TASK_ID,
            "title": module.TASK_TITLE,
            "session_prefix": module.TASK_ID,
            "phases": get_task_phases_for_session(task_id=module.TASK_ID),
            "description": module.TASK_CONFIG.get("template_description") or module.TASK_TOPIC_DETAIL,
            "is_default": module.TASK_ID == DEFAULT_TASK_ID,
        }
        for module in TASK_MODULES
    ]

__all__ = [
    "DEFAULT_TASK_ID",
    "DEFAULT_TASK_PHASES",
    "LLM_TOPIC_DESCRIPTION",
    "RANKING_ITEM_DISPLAY_NAMES",
    "RANKING_ITEMS",
    "SIMILARITY_TASK_CONTEXT",
    "TASK_CONFIG",
    "TASK_CONFIGS",
    "TASK_ID",
    "TASK_MODULES",
    "TASK_TITLE",
    "TASK_TOPIC_DETAIL",
    "TOPIC_DESCRIPTION",
    "get_llm_topic_description_for_session",
    "get_ranking_limit_for_session",
    "get_ranking_item_display_names_for_session",
    "get_ranking_items_for_session",
    "get_similarity_task_context_for_session",
    "get_default_phase_for_session",
    "get_task_phases_for_session",
    "get_task_config_for_session",
    "get_task_module",
    "normalize_phase_for_session",
    "resolve_task_id",
    "serialize_task_config",
    "serialize_task_templates",
]
