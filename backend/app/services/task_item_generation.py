import json
import os
import re
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import IdeaBlock, TaskItem
from ..schemas import ApiError
from ..task_config import get_ranking_items_for_session, get_task_config_for_session


async def build_task_item_ids_with_llm(text: str, *, session_name: str | None = None) -> list[int]:
    ranking_items = get_ranking_items_for_session(session_name=session_name)
    task_config = get_task_config_for_session(session_name=session_name)
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


async def generate_and_save_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    session_name: str | None = None,
    text: str,
) -> list[TaskItem]:
    task_item_ids = await build_task_item_ids_with_llm(text, session_name=session_name)
    logger.info(
        "task_item_ids_generated idea_block_id=%s task_item_ids=%s",
        idea_block_id,
        task_item_ids,
    )
    return await save_task_items_for_idea_block_ids(
        db,
        idea_block_id=idea_block_id,
        task_item_ids=task_item_ids,
    )


async def save_task_items_for_idea_block_ids(
    db: AsyncSession,
    *,
    idea_block_id: int,
    task_item_ids: list[int],
) -> list[TaskItem]:
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
    session_name: str | None = None,
    text: str,
) -> list[TaskItem]:
    resolved_session_name = session_name or await _get_idea_block_session_name(db, idea_block_id)
    task_item_ids = await build_task_item_ids_with_llm(text, session_name=resolved_session_name)
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
