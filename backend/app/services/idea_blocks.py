import json
import os
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..clients import openai_client
from ..config import IDEA_BLOCK_SYSTEM_PROMPT, IDEA_LLM_ENABLE_THINKING, OPENAI_MODEL, logger
from ..models import IdeaBlock, Transcript, Visibility
from ..schemas import ApiError
from ..task_config import get_llm_topic_description_for_session
from .embedding_service import create_text_embedding
from .idea_block_deduplication import find_duplicate_idea_block
from .task_item_generation import build_task_item_ids_with_llm, save_task_items_for_idea_block_ids


def _normalize_blocks(items: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        content = str(item.get("content", "")).strip()
        if not content:
            continue

        summary = item.get("summary")
        summary = str(summary).strip() if summary is not None else content
        if not summary:
            summary = content

        transcript = item.get("transcript")
        transcript = str(transcript).strip() if transcript is not None else None

        normalized.append(
            {
                "content": content,
                "summary": summary,
                "transcript": transcript,
            }
        )

    return normalized


async def build_idea_blocks_with_llm(transcript_text: str, *, session_name: str | None = None) -> list[dict[str, Any]]:
    mock_blocks = _build_mock_idea_blocks(transcript_text)
    if mock_blocks:
        logger.info(
            "idea_llm_mock_used transcript_chars=%s block_count=%s",
            len(transcript_text),
            len(mock_blocks),
        )
        return mock_blocks

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        raise ApiError(
            422,
            "IDEA_GENERATION_FAILED",
            "Idea blocks could not be generated",
            details={"hint": "Set OPENAI_API_KEY or enable LLM_MOCK=1 for local Swagger testing"},
        )

    system_prompt = IDEA_BLOCK_SYSTEM_PROMPT.format(
        topic_description=get_llm_topic_description_for_session(session_name=session_name),
        transcript_text=transcript_text,
    )
    user_prompt = "Return JSON with an idea_blocks array. Each item needs content, summary, and optional transcript."

    try:
        logger.info(
            "idea_llm_request model=%s transcript_chars=%s",
            OPENAI_MODEL,
            len(transcript_text),
        )
        completion = await openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            extra_body={"enable_thinking": IDEA_LLM_ENABLE_THINKING},
        )
        raw_content = completion.choices[0].message.content or "{}"
        logger.info(
            "idea_llm_response model=%s response_chars=%s",
            OPENAI_MODEL,
            len(raw_content),
        )
        parsed = _parse_llm_json_payload(raw_content)
    except Exception as exc:
        logger.exception("idea_llm_failed model=%s error=%s", OPENAI_MODEL, exc)
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

    if not isinstance(blocks, list):
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    normalized_blocks = _normalize_blocks(blocks)
    if blocks and not normalized_blocks:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    logger.info(
        "idea_llm_parsed block_count=%s",
        len(normalized_blocks),
    )
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
    session_name: str,
    participant_id: str,
    visibility: Visibility,
    source_transcript_ids: list[str],
    transcript_text: str,
) -> list[IdeaBlock]:
    generated_blocks = await build_idea_blocks_with_llm(transcript_text, session_name=session_name)

    idea_blocks: list[IdeaBlock] = []
    user_id = _participant_id_to_int(participant_id)

    for block_data in generated_blocks:
        summary = block_data["summary"]
        title = _title_from_content(block_data["content"])
        embedding_vector = await create_text_embedding(summary)
        task_item_ids = await build_task_item_ids_with_llm(summary, session_name=session_name)
        duplicate_match = await find_duplicate_idea_block(
            db,
            session_name=session_name,
            user_id=user_id,
            title=title,
            summary=summary,
            embedding_vector=embedding_vector,
            task_item_ids=task_item_ids,
        )
        if duplicate_match is not None:
            logger.info(
                (
                    "frontend_board_idea_block_deduplicated session_name=%s user_id=%s "
                    "duplicate_id=%s reason=%s similarity=%s"
                ),
                session_name,
                user_id,
                duplicate_match.idea_block_id,
                duplicate_match.reason,
                duplicate_match.similarity,
            )
            continue

        idea_block = IdeaBlock(
            user_id=user_id,
            session_name=session_name,
            title=title,
            summary=summary,
            transcript_id=None,
            embedding_vector=embedding_vector,
            similarity_id=None,
        )
        db.add(idea_block)
        await db.flush()
        await save_task_items_for_idea_block_ids(
            db,
            idea_block_id=idea_block.id,
            task_item_ids=task_item_ids,
            session_name=session_name,
            text=summary,
        )
        idea_blocks.append(idea_block)

    if not idea_blocks:
        return []

    await db.flush()

    result = await db.execute(
        select(IdeaBlock)
        .where(IdeaBlock.id.in_([item.id for item in idea_blocks]))
        .order_by(IdeaBlock.time_stamp.asc())
    )
    return list(result.scalars().all())


async def generate_idea_blocks_from_stream_transcripts(
    db: AsyncSession,
    *,
    session_name: str,
    participant_id: str,
    visibility: Visibility,
    transcripts: list[Any],
) -> list[IdeaBlock]:
    transcript_text = "\n".join(str(item.text) for item in transcripts if getattr(item, "text", None)).strip()
    if not transcript_text:
        return []

    idea_blocks = await generate_and_save_idea_blocks(
        db,
        session_name=session_name,
        participant_id=participant_id,
        visibility=visibility,
        source_transcript_ids=[str(item.segment_id) for item in transcripts if getattr(item, "segment_id", None)],
        transcript_text=transcript_text,
    )
    await db.commit()
    return idea_blocks


async def update_idea_block_fields(
    db: AsyncSession,
    *,
    block_id: str,
    fields: dict[str, Any],
) -> IdeaBlock:
    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.main_transcript))
        .where(IdeaBlock.id == int(block_id))
    )
    block = result.scalar_one_or_none()
    if block is None:
        raise ApiError(
            404,
            "IDEA_BLOCK_NOT_FOUND",
            "Idea block not found",
            details={"field": "block_id", "value": block_id},
        )
    if block.is_deleted:
        raise ApiError(
            409,
            "IDEA_BLOCK_DELETED",
            "Deleted idea blocks cannot be edited",
            details={"field": "block_id", "value": block_id},
        )

    if "content" in fields:
        content = str(fields["content"] or "").strip()
        if not content:
            raise ApiError(
                400,
                "INVALID_PAYLOAD",
                "summary cannot be empty",
                details={"field": "summary"},
            )
        block.summary = content
        block.title = _title_from_content(content)

    if "summary" in fields:
        raw_summary = fields["summary"]
        if raw_summary is not None:
            summary = str(raw_summary).strip()
            if summary:
                block.summary = summary

    if "transcript" in fields:
        transcript_value = "" if fields["transcript"] is None else str(fields["transcript"]).strip()
        if block.main_transcript is None:
            transcript = Transcript(
                user_id=block.user_id,
                session_name=block.session_name,
                transcript=transcript_value,
            )
            db.add(transcript)
            await db.flush()
            block.transcript_id = transcript.id
            block.main_transcript = transcript
        else:
            block.main_transcript.transcript = transcript_value

    await db.flush()
    return block


def _build_mock_idea_blocks(transcript_text: str) -> list[dict[str, Any]] | None:
    llm_mock_flag = os.getenv("LLM_MOCK", "").strip().lower() in {"1", "true", "yes", "on"}
    mock_text = os.getenv("IDEA_BLOCK_MOCK_TEXT", "").strip()
    if not llm_mock_flag and not mock_text:
        return None

    content = mock_text or transcript_text
    content = content.strip() or "Mock idea block content"

    return [
        {
            "content": "Mock idea block",
            "summary": content[:280],
            "transcript": content[:280],
        }
    ]


def _title_from_content(content: str) -> str:
    value = content.strip()[:10]
    return value or "Idea"


def _participant_id_to_int(participant_id: str) -> int:
    try:
        return int(participant_id)
    except (TypeError, ValueError):
        return 0
