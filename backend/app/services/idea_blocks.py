import json
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..clients import openai_client
from ..config import IDEA_BLOCK_SYSTEM_PROMPT, OPENAI_API_KEY, OPENAI_MODEL, logger
from ..models import BulletPoint, IdeaBlock, Visibility
from ..schemas import ApiError, StreamTranscript
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

        raw_bullets = item.get("bullet_points", [])
        bullets = [str(x).strip() for x in raw_bullets if str(x).strip()]

        raw_tags = item.get("tags", [])
        tags = [str(x).strip() for x in raw_tags if str(x).strip()]

        normalized.append(
            {
                "content": content,
                "summary": summary,
                "bullet_points": bullets,
                "tags": tags,
            }
        )

    return normalized


async def build_idea_blocks_with_llm(transcript_text: str) -> list[dict[str, Any]]:
    if not OPENAI_API_KEY:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    system_prompt = (
        "You convert meeting transcript text into idea blocks. "
        "Return strict JSON only, with this schema: "
        '{"idea_blocks":[{"content":"string","summary":"string|null",'
        '"bullet_points":["string"],"tags":["string"]}]}'
    )

    user_prompt = (
        "Create 1-3 concise idea blocks from the following transcript. "
        "Do not include markdown.\n\n"
        f"Transcript:\n{transcript_text}"
    )

    try:
        completion = await openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw_content = completion.choices[0].message.content or "{}"
        parsed = json.loads(raw_content)
    except Exception as exc:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated") from exc

    blocks = parsed.get("idea_blocks")
    if not isinstance(blocks, list) or not blocks:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    normalized_blocks = _normalize_blocks(blocks)
    if not normalized_blocks:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea blocks could not be generated")

    return normalized_blocks


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
            transcript=transcript_text,
            content=block_data["content"],
            summary=block_data["summary"],
            source_transcript_ids=source_transcript_ids,
            tags=block_data["tags"] or None,
            created_at=now,
            updated_at=now,
        )
        db.add(idea_block)
        await db.flush()

        for idx, bullet_text in enumerate(block_data["bullet_points"], start=1):
            bullet = BulletPoint(
                id=str(uuid4()),
                idea_block_id=idea_block.id,
                session_id=session_id,
                participant_id=participant_id,
                visibility=visibility,
                text=bullet_text,
                order_index=idx,
                created_at=utc_now(),
            )
            db.add(bullet)

        idea_blocks.append(idea_block)

    await db.flush()

    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.bullet_points))
        .where(IdeaBlock.id.in_([item.id for item in idea_blocks]))
        .order_by(IdeaBlock.created_at.asc())
    )
    return list(result.scalars().all())


async def build_stream_idea_blocks_with_llm(transcript_text: str) -> list[dict[str, Any]] | None:
    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY is not set, skipping stream idea block generation")
        return None

    user_prompt = f"Transcript: {transcript_text}"

    try:
        completion = await openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": IDEA_BLOCK_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw_content = completion.choices[0].message.content or ""
        parsed = json.loads(raw_content)
    except Exception as exc:
        logger.exception("Failed to get or parse LLM response for stream idea blocks: %s", exc)
        return None

    items: Any
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        maybe_items = parsed.get("idea_blocks")
        if isinstance(maybe_items, list):
            items = maybe_items
        else:
            logger.warning("LLM JSON payload is not an array, skipping idea block generation")
            return None
    else:
        logger.warning("LLM JSON payload type is invalid, skipping idea block generation")
        return None

    normalized = _normalize_blocks(items)
    return normalized if normalized else None


async def generate_idea_blocks_from_stream_transcripts(
    db: AsyncSession,
    *,
    session_id: str,
    participant_id: str,
    visibility: Visibility,
    transcripts: list[StreamTranscript],
) -> None:
    if not transcripts:
        return

    transcript_text = "\n".join(item.text for item in transcripts if item.text.strip()).strip()
    if not transcript_text:
        return

    source_transcript_ids = [item.segment_id for item in transcripts]
    llm_blocks = await build_stream_idea_blocks_with_llm(transcript_text)
    if not llm_blocks:
        return

    now = utc_now()
    try:
        for block_data in llm_blocks:
            idea_block = IdeaBlock(
                id=str(uuid4()),
                session_id=session_id,
                participant_id=participant_id,
                visibility=visibility,
                transcript=transcript_text,
                content=block_data["content"],
                summary=block_data["summary"],
                source_transcript_ids=source_transcript_ids,
                tags=block_data["tags"] or None,
                created_at=now,
                updated_at=now,
            )
            db.add(idea_block)
            await db.flush()

            for index, bullet_text in enumerate(block_data["bullet_points"], start=1):
                db.add(
                    BulletPoint(
                        id=str(uuid4()),
                        idea_block_id=idea_block.id,
                        session_id=session_id,
                        participant_id=participant_id,
                        visibility=visibility,
                        text=bullet_text,
                        order_index=index,
                        created_at=utc_now(),
                    )
                )
        await db.commit()
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("Failed to save stream-generated idea blocks: %s", exc)
