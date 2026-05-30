import json
import os
import re
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import PosterIdeaBlockTaskItem, TaskItem
from ..schemas import ApiError
from ..task_config import RANKING_ITEMS, TASK_CONFIG
from ..task_config.enhance_the_poster import ACTION_IDS, ADVANCED_ACTION_IDS, POSTER_COMPONENT_IDS
from ..task_config.registry import DEFAULT_TASK_NAME, get_task_prompt_config, normalize_task_name


TASK_ITEM_CONFIGS_BY_ID = {item["id"]: item for item in TASK_CONFIG["items"]}


async def build_task_item_ids_with_llm(text: str) -> list[int]:
    mock_ids = _build_mock_task_item_ids()
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
        _format_ranking_item_line(index, item)
        for index, item in enumerate(RANKING_ITEMS, start=1)
    )
    system_prompt = (
        "You classify user text for the Lost at Sea ranking task.\n"
        "Use only this exact TASK_ITEMS list. The number at the start of each line is the "
        "1-based task_item_id that must be returned:\n"
        f"{item_lines}\n\n"
        "Given the user input, decide which TASK_ITEMS are being discussed. "
        "The input may be in Mandarin Chinese, English, or mixed language. "
        "Match against config_id, Chinese label, English label, and aliases. "
        "Return every matching item mentioned or clearly referred to in the input; "
        "do not limit the answer to only the most important or most recent item. "
        "If the user says medical alcohol, high-proof alcohol, disinfectant alcohol, "
        "or alcohol for disinfection, map it to the current TASK_ITEMS entry for rum. "
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

    normalized_ids = _normalize_task_item_ids(ids)
    logger.info(
        "task_item_llm_parsed task_item_ids=%s",
        normalized_ids,
    )
    return normalized_ids


async def build_poster_task_items_with_llm(text: str) -> list[dict[str, str]]:
    task_config = get_task_prompt_config("enhance-the-poster")
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        raise ApiError(
            422,
            "TASK_ITEM_GENERATION_FAILED",
            "Task items could not be generated",
            details={"hint": "Set OPENAI_API_KEY for poster task item detection"},
        )

    poster_component_lines = "\n".join(
        _format_poster_option_line(item)
        for item in task_config.poster_components or []
    )
    advanced_action_lines = "\n".join(
        _format_poster_option_line(item)
        for item in task_config.advanced_actions or []
    )
    system_prompt = f"""
You classify user text for the Enhance The Poster task.

Use only this exact POSTER_TASK_ITEMS vocabulary.

Poster components:
{poster_component_lines}

Actions:
- add
- remove
- edit

Advanced actions:
{advanced_action_lines}

Given the user input, identify every poster improvement task item being discussed.
Each returned item must include:
- poster_component
- action
- advanced_action

Rules:
- The input may be Mandarin Chinese, English, or mixed language.
- Match against ids, Chinese labels, English labels, and obvious synonyms.
- If the user proposes changing an existing element, use action="edit".
- If the user proposes adding a missing element, use action="add".
- If the user proposes deleting an element, use action="remove".
- Do not invent components or advanced actions.
- Deduplicate exact triples.
- Return JSON only in this exact shape:
{{"poster_task_items":[{{"poster_component":"title","action":"edit","advanced_action":"enlarge"}}]}}
- If unrelated, return {{"poster_task_items":[]}}.
""".strip()
    user_prompt = f"User input:\n{text.strip()}"

    try:
        logger.info(
            "poster_task_item_llm_request model=%s text_chars=%s",
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
            "poster_task_item_llm_response model=%s response_chars=%s",
            OPENAI_MODEL,
            len(raw_content),
        )
        parsed = _parse_llm_json_payload(raw_content)
    except ApiError:
        raise
    except Exception as exc:
        logger.exception("poster_task_item_llm_failed model=%s error=%s", OPENAI_MODEL, exc)
        raise ApiError(
            422,
            "TASK_ITEM_GENERATION_FAILED",
            "Task items could not be generated",
            details={"provider": "openai", "reason": exc.__class__.__name__},
        ) from exc

    if not isinstance(parsed, dict):
        raise ApiError(422, "TASK_ITEM_GENERATION_FAILED", "Task items could not be generated")

    items = parsed.get("poster_task_items")
    if not isinstance(items, list):
        raise ApiError(422, "TASK_ITEM_GENERATION_FAILED", "Task items could not be generated")

    normalized_items = _normalize_poster_task_items(items)
    logger.info(
        "poster_task_item_llm_parsed poster_task_items=%s",
        normalized_items,
    )
    return normalized_items


async def generate_and_save_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    text: str,
    task_name: str = DEFAULT_TASK_NAME,
) -> list[TaskItem | PosterIdeaBlockTaskItem]:
    task_name = normalize_task_name(task_name)
    if task_name == "enhance-the-poster":
        return await generate_and_save_poster_task_items_for_idea_block(
            db,
            idea_block_id=idea_block_id,
            text=text,
        )

    task_item_ids = await build_task_item_ids_with_llm(text)
    logger.info(
        "task_item_ids_generated idea_block_id=%s task_item_ids=%s",
        idea_block_id,
        task_item_ids,
    )
    task_items = [
        TaskItem(idea_block_id=idea_block_id, task_item_id=task_item_id)
        for task_item_id in task_item_ids
    ]
    if not task_items:
        logger.info(
            "task_item_rows_skipped_empty idea_block_id=%s",
            idea_block_id,
        )
        return []

    db.add_all(task_items)
    await db.flush()
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
    text: str,
    task_name: str = DEFAULT_TASK_NAME,
) -> list[TaskItem | PosterIdeaBlockTaskItem]:
    task_name = normalize_task_name(task_name)
    if task_name == "enhance-the-poster":
        return await replace_poster_task_items_for_idea_block(
            db,
            idea_block_id=idea_block_id,
            text=text,
        )

    task_item_ids = await build_task_item_ids_with_llm(text)
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
    logger.info(
        "task_item_rows_replaced idea_block_id=%s count=%s",
        idea_block_id,
        len(task_items),
    )
    return task_items


async def generate_and_save_poster_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    text: str,
) -> list[PosterIdeaBlockTaskItem]:
    poster_task_items = await build_poster_task_items_with_llm(text)
    rows = [
        PosterIdeaBlockTaskItem(
            idea_block_id=idea_block_id,
            poster_component=item["poster_component"],
            action=item["action"],
            advanced_action=item["advanced_action"],
        )
        for item in poster_task_items
    ]
    if not rows:
        logger.info("poster_task_item_rows_skipped_empty idea_block_id=%s", idea_block_id)
        return []

    db.add_all(rows)
    await db.flush()
    logger.info("poster_task_item_rows_saved idea_block_id=%s count=%s", idea_block_id, len(rows))
    return rows


async def replace_poster_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    text: str,
) -> list[PosterIdeaBlockTaskItem]:
    poster_task_items = await build_poster_task_items_with_llm(text)
    await db.execute(delete(PosterIdeaBlockTaskItem).where(PosterIdeaBlockTaskItem.idea_block_id == idea_block_id))
    rows = [
        PosterIdeaBlockTaskItem(
            idea_block_id=idea_block_id,
            poster_component=item["poster_component"],
            action=item["action"],
            advanced_action=item["advanced_action"],
        )
        for item in poster_task_items
    ]
    if rows:
        db.add_all(rows)
        await db.flush()
    logger.info("poster_task_item_rows_replaced idea_block_id=%s count=%s", idea_block_id, len(rows))
    return rows


def _normalize_task_item_ids(values: list[Any]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for value in values:
        if not isinstance(value, int):
            continue
        if value < 1 or value > len(RANKING_ITEMS):
            continue
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _format_ranking_item_line(index: int, item_id: str) -> str:
    item = TASK_ITEM_CONFIGS_BY_ID[item_id]
    aliases = ", ".join(dict.fromkeys([item["label_en"], *item["aliases"]]))
    return (
        f'{index}. task_item_id={index}; config_id="{item_id}"; '
        f'zh="{item["label_zh"]}"; en="{item["label_en"]}"; aliases="{aliases}"'
    )


def _format_poster_option_line(item: dict[str, str]) -> str:
    return f'- id="{item["id"]}"; zh="{item["label_zh"]}"; en="{item["label_en"]}"'


def _normalize_poster_task_items(values: list[Any]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        poster_component = str(value.get("poster_component") or "").strip()
        action = str(value.get("action") or "").strip()
        advanced_action = str(value.get("advanced_action") or "").strip()
        if poster_component not in POSTER_COMPONENT_IDS:
            continue
        if action not in ACTION_IDS:
            continue
        if advanced_action not in ADVANCED_ACTION_IDS:
            continue
        key = (poster_component, action, advanced_action)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "poster_component": poster_component,
                "action": action,
                "advanced_action": advanced_action,
            }
        )
    return normalized


def _build_mock_task_item_ids() -> list[int] | None:
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
    return _normalize_task_item_ids(values)


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
