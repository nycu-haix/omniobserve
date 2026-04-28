import json
import os
import re
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..clients import openai_client
from ..config import IDEA_BLOCK_SYSTEM_PROMPT, OPENAI_MODEL, logger
from ..models import IdeaBlock, Visibility
from ..schemas import ApiError
from ..utils import utc_now


def _normalize_blocks(items: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        content = str(item.get("content", "")).strip()
        if not content:
            continue

        summary = item.get("summary")
        if summary is not None:
            summary = str(summary).strip() or None

        transcript = item.get("transcript")
        if transcript is not None:
            transcript = str(transcript).strip() or None

        raw_bullets = item.get("bullet_points", [])
        bullets = [str(x).strip() for x in raw_bullets if str(x).strip()]
        if bullets:
            logger.debug("Ignoring legacy bullet_points field from model output")

        normalized.append(
            {
                "content": content,
                "summary": summary,
                "transcript": transcript,
            }
        )

    return normalized


async def build_idea_blocks_with_llm(transcript_text: str) -> list[dict[str, Any]]:
    mock_blocks = _build_mock_idea_blocks(transcript_text)
    if mock_blocks:
        return mock_blocks

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        raise ApiError(
            422,
            "IDEA_GENERATION_FAILED",
            "Idea blocks could not be generated",
            details={"hint": "Set OPENAI_API_KEY or enable LLM_MOCK=1 for local Swagger testing"},
        )

    system_prompt = IDEA_BLOCK_SYSTEM_PROMPT.format(transcript_text=transcript_text)
    user_prompt = "請依照系統規則輸出 JSON。"

    try:
        completion = await openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw_content = completion.choices[0].message.content or "{}"
        parsed = _parse_llm_json_payload(raw_content)
    except Exception as exc:
        logger.exception("LLM idea block generation failed: %s", exc)
        raise ApiError(
            422,
            "IDEA_GENERATION_FAILED",
            "Idea blocks could not be generated",
            details={"provider": "openai", "reason": exc.__class__.__name__},
        ) from exc

    if isinstance(parsed, list):
        blocks = parsed
    elif isinstance(parsed, dict):
        blocks = parsed.get("idea_blocks")
    else:
        blocks = None

    if not isinstance(blocks, list) or not blocks:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    normalized_blocks = _normalize_blocks(blocks)
    if not normalized_blocks:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    return normalized_blocks


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

    start_object = text.find("{")
    start_array = text.find("[")
    starts = [idx for idx in (start_object, start_array) if idx != -1]
    if not starts:
        raise json.JSONDecodeError("No JSON object/array found", text, 0)
    start = min(starts)
    sliced = text[start:]

    for end in range(len(sliced), 0, -1):
        candidate = sliced[:end].strip()
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise json.JSONDecodeError("Unable to parse JSON payload", text, start)


async def generate_and_save_idea_blocks(
    db: AsyncSession,
    *,
    session_id: str,
    participant_id: str,
    visibility: Visibility,
    source_transcript_ids: list[str],
    transcript_text: str,
) -> list[IdeaBlock]:
    generated_blocks = await build_idea_blocks_with_llm(transcript_text)

    idea_blocks: list[IdeaBlock] = []
    now = utc_now()

    for block_data in generated_blocks:
        idea_block = IdeaBlock(
            id=str(uuid4()),
            session_id=session_id,
            participant_id=participant_id,
            visibility=visibility,
            transcript=block_data.get("transcript") or transcript_text,
            content=block_data["content"],
            summary=block_data["summary"],
            source_transcript_ids=source_transcript_ids,
            tags=None,
            created_at=now,
            updated_at=now,
        )
        db.add(idea_block)
        await db.flush()

        idea_blocks.append(idea_block)

    await db.flush()

    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.bullet_points))
        .where(IdeaBlock.id.in_([item.id for item in idea_blocks]))
        .order_by(IdeaBlock.created_at.asc())
    )
    return list(result.scalars().all())


async def generate_idea_blocks_from_stream_transcripts(
    db: AsyncSession,
    *,
    session_id: str,
    participant_id: str,
    visibility: Visibility,
    transcripts: list[Any],
) -> list[IdeaBlock]:
    transcript_text = "\n".join(str(item.text) for item in transcripts if getattr(item, "text", None)).strip()
    if not transcript_text:
        return []

    idea_blocks = await generate_and_save_idea_blocks(
        db,
        session_id=session_id,
        participant_id=participant_id,
        visibility=visibility,
        source_transcript_ids=[str(item.segment_id) for item in transcripts if getattr(item, "segment_id", None)],
        transcript_text=transcript_text,
    )
    await db.commit()
    return idea_blocks


def _build_mock_idea_blocks(transcript_text: str) -> list[dict[str, Any]] | None:
    llm_mock_flag = os.getenv("LLM_MOCK", "").strip().lower() in {"1", "true", "yes", "on"}
    mock_text = os.getenv("IDEA_BLOCK_MOCK_TEXT", "").strip()
    if not llm_mock_flag and not mock_text:
        return None

    content = mock_text or transcript_text
    content = content.strip() or "Mock idea block content"

    return [
        {
            "content": "會議主軸是定義即時音訊到 idea blocks 的端到端流程。",
            "summary": "重點在先穩定打通音訊到文字，再將文字整理為可操作的 idea blocks。",
            "transcript": content[:280],
        }
    ]
