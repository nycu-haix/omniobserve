import json
import os
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..clients import openai_client
from ..config import OPENAI_MODEL, logger
from ..models import TaskItem
from ..schemas import ApiError

RANKING_ITEMS = [
    "mosquito_net",
    "petrol",
    "water_container",
    "shaving_mirror",
    "sextant",
    "emergency_rations",
    "sea_chart",
    "floating_cushion",
    "rope",
    "chocolate_bars",
    "waterproof_sheet",
    "fishing_rod",
    "shark_repellent",
    "rum",
    "vhf_radio",
]

RANKING_ITEM_DISPLAY_NAMES = {
    "mosquito_net": ("蚊帳", "mosquito net"),
    "petrol": ("一罐汽油", "petrol, gasoline"),
    "water_container": ("裝水容器", "water container"),
    "shaving_mirror": ("刮鬍鏡／小鏡子", "shaving mirror, small mirror"),
    "sextant": ("六分儀", "sextant"),
    "emergency_rations": ("緊急口糧", "emergency rations"),
    "sea_chart": ("海圖", "sea chart"),
    "floating_cushion": ("漂浮坐墊", "floating cushion"),
    "rope": ("繩子", "rope"),
    "chocolate_bars": ("巧克力棒", "chocolate bars"),
    "waterproof_sheet": ("防水布", "waterproof sheet, tarpaulin"),
    "fishing_rod": ("釣魚竿", "fishing rod"),
    "shark_repellent": ("驅鯊劑", "shark repellent"),
    "rum": ("一瓶蘭姆酒", "rum"),
    "vhf_radio": ("VHF 無線電", "VHF radio"),
}


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
        "You are a survival-task assistant. The predefined item list uses 1-based ids:\n"
        f"{item_lines}\n\n"
        "Given the user input, decide which list items are being discussed. "
        "The input may be in Mandarin Chinese, English, or mixed language. "
        "Match against the item id, Chinese display name, and English aliases. "
        "Return every matching item mentioned or clearly referred to in the input; "
        "do not limit the answer to only the most important or most recent item. "
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


async def generate_and_save_task_items_for_idea_block(
    db: AsyncSession,
    *,
    idea_block_id: int,
    text: str,
) -> list[TaskItem]:
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
    chinese_name, english_aliases = RANKING_ITEM_DISPLAY_NAMES[item_id]
    return f"{index}. {item_id} - {chinese_name} ({english_aliases})"


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
