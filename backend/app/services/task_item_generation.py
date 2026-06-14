import json
import os
import re
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import IdeaBlock, PosterIdeaBlockTaskItem, TaskItem
from ..schemas import ApiError
from ..task_config import get_ranking_items_for_session, get_task_config_for_session, resolve_task_id


def _resolve_task_name(session_name: str | None, task_name: str | None) -> str:
    return resolve_task_id(session_name=session_name, task_id=task_name)


async def build_task_item_ids_with_llm(text: str, *, session_name: str | None = None, task_name: str | None = None) -> list[int]:
    resolved_task_name = _resolve_task_name(session_name, task_name)
    ranking_items = get_ranking_items_for_session(session_name=session_name, task_id=resolved_task_name)
    task_config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_name)
    task_item_configs_by_id = {item["id"]: item for item in task_config["items"]}

    mock_ids = _build_mock_task_item_ids(ranking_items)
    if mock_ids is not None:
        logger.info(
            "task_item_llm_mock_used text_chars=%s task_item_ids=%s",
            len(text),
            mock_ids,
        )
        return mock_ids

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        raise ApiError(
            422,
            "TASK_ITEM_GENERATION_FAILED",
            "Task items could not be generated",
            details={"hint": "Set OPENAI_API_KEY or TASK_ITEM_MOCK_IDS for local Swagger testing"},
        )

    item_lines = "\n".join(
        _format_ranking_item_line(index, item, task_item_configs_by_id)
        for index, item in enumerate(ranking_items, start=1)
    )
    system_prompt = (
        f"You classify user text for the {task_config['title']} ranking task.\n"
        "Use only this exact TASK_ITEMS list. The number at the start of each line is the "
        "1-based task_item_id that must be returned:\n"
        f"{item_lines}\n\n"
        "Given the user input, decide which TASK_ITEMS are being discussed. "
        "The input may be in Mandarin Chinese, English, or mixed language. "
        "Match against config_id, Chinese label, English label, and aliases. "
        "Return every matching item mentioned or clearly referred to in the input; "
        "do not limit the answer to only the most important or most recent item. "
        "Do not invent items, do not return zero-based indices, and do not return config_id strings. "
        'Return only JSON in this exact shape: {"task_item_ids":[...]} . '
        'If unrelated, return {"task_item_ids":[]}.'
    )
    user_prompt = f"User input:\n{text.strip()}"

    try:
        logger.info(
            "task_item_llm_request model=%s text_chars=%s",
            OPENAI_MODEL,
            len(text),
        )
        completion = await openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw_content = completion.choices[0].message.content or "{}"
        logger.info(
            "task_item_llm_response model=%s response_chars=%s",
            OPENAI_MODEL,
            len(raw_content),
        )
        parsed = _parse_llm_json_payload(raw_content)
    except ApiError:
        raise
    except Exception as exc:
        logger.exception("task_item_llm_failed model=%s error=%s", OPENAI_MODEL, exc)
        raise ApiError(
            422,
            "TASK_ITEM_GENERATION_FAILED",
            "Task items could not be generated",
            details={"provider": "openai", "reason": exc.__class__.__name__},
        ) from exc

    if not isinstance(parsed, dict):
        raise ApiError(422, "TASK_ITEM_GENERATION_FAILED", "Task items could not be generated")

    ids = parsed.get("task_item_ids")
    if not isinstance(ids, list):
        raise ApiError(422, "TASK_ITEM_GENERATION_FAILED", "Task items could not be generated")

    normalized_ids = _normalize_task_item_ids(ids, ranking_items)
    logger.info(
        "task_item_llm_parsed task_item_ids=%s",
        normalized_ids,
    )
    return normalized_ids


def build_task_item_ids_by_keyword(text: str, *, session_name: str | None = None, task_name: str | None = None) -> list[int]:
    resolved_task_name = _resolve_task_name(session_name, task_name)
    ranking_items = get_ranking_items_for_session(session_name=session_name, task_id=resolved_task_name)
    task_config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_name)
    task_item_configs_by_id = {item["id"]: item for item in task_config["items"]}
    normalized_text = _normalize_keyword_text(text)
    if not normalized_text:
        return []

    matched_ids: list[int] = []
    for index, item_id in enumerate(ranking_items, start=1):
        item = task_item_configs_by_id.get(item_id)
        if item is None:
            continue
        keywords = [
            item_id,
            item.get("label_zh"),
            item.get("label_en"),
            *(item.get("aliases") or []),
        ]
        if _text_matches_any_keyword(normalized_text, keywords):
            matched_ids.append(index)
    return matched_ids


async def build_poster_component_ids_with_llm(text: str, *, session_name: str | None = None, task_name: str | None = None) -> list[str]:
    keyword_ids = build_poster_component_ids_by_keyword(text, session_name=session_name, task_name=task_name)
    if keyword_ids:
        logger.info(
            "poster_component_keyword_match text_chars=%s component_ids=%s",
            len(text),
            keyword_ids,
        )
        return keyword_ids

    resolved_task_name = _resolve_task_name(session_name, task_name)
    task_config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_name)
    builder = task_config.get("phase1_builder") or {}
    components = [item for item in builder.get("components", []) if item.get("id")]
    if not components:
        return []

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        logger.info("poster_component_match_skipped_no_openai_key text_chars=%s", len(text))
        return []

    component_lines = "\n".join(_format_builder_option_line(item) for item in components)
    system_prompt = (
        "You classify live public discussion for the Enhance the Poster task.\n"
        "Use only this exact poster component vocabulary.\n\n"
        f"Components:\n{component_lines}\n\n"
        "Identify every poster component that is explicitly mentioned or clearly referred to. "
        "The input may be Mandarin Chinese, English, or mixed language. "
        "Match against component ids, Chinese labels, English labels, descriptions, aliases, "
        "location references, function references, and visual descriptions. "
        "Participant wording may be imprecise, such as 左上角那張圖, 右下角報名區, "
        "下面那個單位資訊, or 那段時間地點說明. "
        "Do not require an edit action such as move, enlarge, or change color. "
        "Do not invent components. "
        'Return JSON only in this exact shape: {"component_ids":["main_title"]} . '
        'If unrelated, return {"component_ids":[]}.'
    )
    completion = await openai_client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Public discussion:\n{text.strip()}"},
        ],
    )
    parsed = _parse_llm_json_payload(completion.choices[0].message.content or "{}")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("component_ids"), list):
        return []
    return _normalize_component_ids(
        parsed["component_ids"],
        valid_component_ids={str(item["id"]) for item in components},
    )


def build_poster_component_ids_by_keyword(text: str, *, session_name: str | None = None, task_name: str | None = None) -> list[str]:
    resolved_task_name = _resolve_task_name(session_name, task_name)
    task_config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_name)
    builder = task_config.get("phase1_builder") or {}
    components = [item for item in builder.get("components", []) if item.get("id")]
    normalized_text = _normalize_keyword_text(text)
    if not normalized_text:
        return []

    matched_ids: list[str] = []
    for component in components:
        component_id = str(component["id"])
        keywords = [
            component_id,
            component.get("label_zh"),
            component.get("label_en"),
            component.get("description_zh"),
            *(component.get("aliases") or []),
        ]
        if _text_matches_any_keyword(normalized_text, keywords):
            matched_ids.append(component_id)
    return matched_ids


async def generate_and_save_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    session_name: str | None = None,
    task_name: str | None = None,
    text: str,
) -> list[TaskItem]:
    task_item_ids = await build_task_item_ids_with_llm(text, session_name=session_name, task_name=task_name)
    logger.info(
        "task_item_ids_generated idea_block_id=%s task_item_ids=%s",
        idea_block_id,
        task_item_ids,
    )
    return await save_task_items_for_idea_block_ids(
        db,
        idea_block_id=idea_block_id,
        task_item_ids=task_item_ids,
        session_name=session_name,
        task_name=task_name,
        text=text,
    )


async def save_task_items_for_idea_block_ids(
    db: AsyncSession,
    *,
    idea_block_id: int,
    task_item_ids: list[int],
    session_name: str | None = None,
    task_name: str | None = None,
    text: str | None = None,
) -> list[TaskItem]:
    idea_block = await db.get(IdeaBlock, idea_block_id)
    resolved_session_name = session_name or (idea_block.session_name if idea_block is not None else None)
    resolved_task_name = task_name or (idea_block.task_name if idea_block is not None else None)
    mapping_text = text if text is not None else (idea_block.summary if idea_block is not None else "")
    task_items = [
        TaskItem(idea_block_id=idea_block_id, task_item_id=task_item_id)
        for task_item_id in task_item_ids
    ]
    if not task_items:
        logger.info(
            "task_item_rows_skipped_empty idea_block_id=%s",
            idea_block_id,
        )
        await replace_poster_component_mappings_for_idea_block(
            db,
            idea_block_id=idea_block_id,
            session_name=resolved_session_name,
            task_name=resolved_task_name,
            text=mapping_text,
        )
        return []

    db.add_all(task_items)
    await db.flush()
    await replace_poster_component_mappings_for_idea_block(
        db,
        idea_block_id=idea_block_id,
        session_name=resolved_session_name,
        task_name=resolved_task_name,
        text=mapping_text,
    )
    logger.info(
        "task_item_rows_saved idea_block_id=%s count=%s",
        idea_block_id,
        len(task_items),
    )
    return task_items


async def replace_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    session_name: str | None = None,
    task_name: str | None = None,
    text: str,
) -> list[TaskItem]:
    idea_block = await db.get(IdeaBlock, idea_block_id)
    resolved_session_name = session_name or (idea_block.session_name if idea_block is not None else None)
    resolved_task_name = task_name or (idea_block.task_name if idea_block is not None else None)
    task_item_ids = await build_task_item_ids_with_llm(text, session_name=resolved_session_name, task_name=resolved_task_name)
    logger.info(
        "task_item_ids_rebuilt idea_block_id=%s task_item_ids=%s",
        idea_block_id,
        task_item_ids,
    )
    await db.execute(delete(TaskItem).where(TaskItem.idea_block_id == idea_block_id))
    task_items = [
        TaskItem(idea_block_id=idea_block_id, task_item_id=task_item_id)
        for task_item_id in task_item_ids
    ]
    if task_items:
        db.add_all(task_items)
        await db.flush()
    await replace_poster_component_mappings_for_idea_block(
        db,
        idea_block_id=idea_block_id,
        session_name=resolved_session_name,
        task_name=resolved_task_name,
        text=text,
    )
    logger.info(
        "task_item_rows_replaced idea_block_id=%s count=%s",
        idea_block_id,
        len(task_items),
    )
    return task_items


async def replace_poster_component_mappings_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    session_name: str | None,
    task_name: str | None = None,
    text: str,
) -> list[PosterIdeaBlockTaskItem]:
    resolved_task_name = _resolve_task_name(session_name, task_name)
    task_config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_name)
    if task_config.get("task_id") != "enhance-the-poster":
        return []

    mappings = await build_poster_component_action_mappings_with_llm(text, session_name=session_name, task_name=resolved_task_name)
    await db.execute(delete(PosterIdeaBlockTaskItem).where(PosterIdeaBlockTaskItem.idea_block_id == idea_block_id))
    rows = [
        PosterIdeaBlockTaskItem(
            idea_block_id=idea_block_id,
            component_id=mapping["component_id"],
            action_id=mapping["action_id"],
        )
        for mapping in mappings
    ]
    if rows:
        db.add_all(rows)
        await db.flush()
    logger.info(
        "poster_idea_block_task_item_rows_replaced idea_block_id=%s count=%s",
        idea_block_id,
        len(rows),
    )
    return rows


async def build_poster_component_action_mappings_with_llm(
    text: str,
    *,
    session_name: str | None = None,
    task_name: str | None = None,
) -> list[dict[str, str]]:
    resolved_task_name = _resolve_task_name(session_name, task_name)
    task_config = get_task_config_for_session(session_name=session_name, task_id=resolved_task_name)
    builder = task_config.get("phase1_builder") or {}
    components = [item for item in builder.get("components", []) if item.get("id")]
    actions = [
        item
        for item in builder.get("actions", [])
        if item.get("id") and not item.get("requires_detail") and not item.get("detail_input")
    ]
    if not components or not actions:
        return []

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        logger.info("poster_component_mapping_skipped_no_openai_key text_chars=%s", len(text))
        return []

    component_lines = "\n".join(_format_builder_option_line(item) for item in components)
    action_lines = "\n".join(_format_builder_option_line(item) for item in actions)
    system_prompt = (
        "You classify user text for the Enhance the Poster task.\n"
        "Use only this exact component/action vocabulary.\n\n"
        f"Components:\n{component_lines}\n\n"
        f"Actions:\n{action_lines}\n\n"
        "Identify every poster improvement component/action pair being discussed. "
        "The input may be Mandarin Chinese, English, or mixed language. "
        "Match components against ids, Chinese labels, English labels, descriptions, aliases, "
        "location references, function references, and visual descriptions. "
        "Participant wording may be imprecise, such as 左上角那張圖, 右下角報名區, "
        "下面那個單位資訊, or 那段時間地點說明. "
        "Match actions against ids, Chinese labels, English labels, descriptions, and obvious synonyms. "
        "Do not invent components or actions. Deduplicate exact pairs. "
        'Return JSON only in this exact shape: {"poster_task_items":[{"component_id":"main_title","action_id":"enlarge"}]} . '
        'If unrelated, return {"poster_task_items":[]}.'
    )
    completion = await openai_client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"User input:\n{text.strip()}"},
        ],
    )
    parsed = _parse_llm_json_payload(completion.choices[0].message.content or "{}")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("poster_task_items"), list):
        return []
    return _normalize_poster_component_action_mappings(
        parsed["poster_task_items"],
        valid_component_ids={str(item["id"]) for item in components},
        valid_action_ids={str(item["id"]) for item in actions},
    )


def _format_builder_option_line(item: dict[str, Any]) -> str:
    label_parts = _join_option_terms(item.get("label_zh"), item.get("label_en"))
    description = str(item.get("description_zh") or "")
    aliases = _join_option_terms(*(item.get("aliases") or []))
    return f'- id="{item["id"]}"; labels="{label_parts}"; description="{description}"; aliases="{aliases}"'


def _join_option_terms(*values: Any) -> str:
    return ", ".join(dict.fromkeys(str(value) for value in values if value))


def _normalize_poster_component_action_mappings(
    values: list[Any],
    *,
    valid_component_ids: set[str],
    valid_action_ids: set[str],
) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        component_id = str(value.get("component_id") or value.get("poster_component") or "").strip()
        action_id = str(value.get("action_id") or value.get("action") or "").strip()
        if component_id not in valid_component_ids or action_id not in valid_action_ids:
            continue
        key = (component_id, action_id)
        if key in seen:
            continue
        seen.add(key)
        normalized.append({"component_id": component_id, "action_id": action_id})
    return normalized


def _normalize_component_ids(values: list[Any], *, valid_component_ids: set[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        component_id = str(value or "").strip()
        if component_id not in valid_component_ids or component_id in seen:
            continue
        seen.add(component_id)
        normalized.append(component_id)
    return normalized


def _normalize_task_item_ids(values: list[Any], ranking_items: list[str]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for value in values:
        if not isinstance(value, int):
            continue
        if value < 1 or value > len(ranking_items):
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _normalize_keyword_text(value: str) -> str:
    return "".join(character.casefold() for character in value if character.isalnum())


def _text_matches_any_keyword(normalized_text: str, keywords: list[Any]) -> bool:
    for keyword in keywords:
        normalized_keyword = _normalize_keyword_text(str(keyword or ""))
        if not normalized_keyword:
            continue
        if normalized_keyword in normalized_text:
            return True
    return False


def _format_ranking_item_line(index: int, item_id: str, task_item_configs_by_id: dict[str, Any]) -> str:
    item = task_item_configs_by_id[item_id]
    aliases = ", ".join(dict.fromkeys([item["label_en"], *item["aliases"]]))
    return (
        f'{index}. task_item_id={index}; config_id="{item_id}"; '
        f'zh="{item["label_zh"]}"; en="{item["label_en"]}"; aliases="{aliases}"'
    )


def _build_mock_task_item_ids(ranking_items: list[str]) -> list[int] | None:
    raw_value = os.getenv("TASK_ITEM_MOCK_IDS", "").strip()
    if not raw_value:
        return None

    values: list[Any] = []
    for item in raw_value.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            values.append(int(item))
        except ValueError:
            continue
    return _normalize_task_item_ids(values, ranking_items)


async def _get_idea_block_session_name(db: AsyncSession, idea_block_id: int) -> str | None:
    idea_block = await db.get(IdeaBlock, idea_block_id)
    return idea_block.session_name if idea_block is not None else None


def _parse_llm_json_payload(raw_content: str) -> Any:
    text = raw_content.strip()
    if not text:
        return {}

    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()

    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    if start == -1:
        raise ApiError(422, "TASK_ITEM_GENERATION_FAILED", "Task items could not be generated")
    sliced = text[start:]

    for end in range(len(sliced), 0, -1):
        candidate = sliced[:end].strip()
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise ApiError(422, "TASK_ITEM_GENERATION_FAILED", "Task items could not be generated")
