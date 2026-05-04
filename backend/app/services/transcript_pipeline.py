import asyncio
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock, TaskItem, Transcript, Visibility
from ..schemas import ApiError, StreamTranscript
from .embedding_service import create_text_embedding
from .idea_blocks import build_idea_blocks_with_llm
from .task_item_generation import generate_and_save_task_items_for_idea_block


@dataclass
class PipelineResult:
    idea_blocks: list[IdeaBlock]
    task_items: list[TaskItem]


_pending_transcripts: dict[tuple[str, int], list[StreamTranscript]] = defaultdict(list)
_pipeline_locks: dict[tuple[str, int], asyncio.Lock] = defaultdict(asyncio.Lock)


async def handle_transcript_segment(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    transcript: StreamTranscript | None,
    is_final: bool,
    visibility: Visibility,
) -> PipelineResult | None:
    key = (session_name, user_id)

    async with _pipeline_locks[key]:
        if transcript is not None:
            _pending_transcripts[key].append(transcript)
            logger.info(
                "Transcript pipeline buffered segment session_name=%s user_id=%s segment_id=%s is_final=%s pending=%s",
                session_name,
                user_id,
                transcript.segment_id,
                is_final,
                len(_pending_transcripts[key]),
            )

        if not is_final:
            return None

        transcripts = list(_pending_transcripts.pop(key, []))
        logger.info(
            "Transcript pipeline final flush session_name=%s user_id=%s segment_count=%s",
            session_name,
            user_id,
            len(transcripts),
        )

    if not transcripts:
        return None

    return await generate_idea_blocks_with_task_items_from_transcripts(
        db,
        session_name=session_name,
        user_id=user_id,
        visibility=visibility,
        transcripts=transcripts,
    )


async def generate_idea_blocks_with_task_items_from_transcripts(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    visibility: Visibility,
    transcripts: list[StreamTranscript],
) -> PipelineResult:
    transcript_text = "\n".join(item.text for item in transcripts if item.text).strip()
    if not transcript_text:
        logger.info(
            "Transcript pipeline skipped empty transcript batch session_name=%s user_id=%s",
            session_name,
            user_id,
        )
        return PipelineResult(idea_blocks=[], task_items=[])

    try:
        logger.info(
            "Transcript pipeline started session_name=%s user_id=%s transcript_count=%s transcript_chars=%s",
            session_name,
            user_id,
            len(transcripts),
            len(transcript_text),
        )
        generated_blocks = await build_idea_blocks_with_llm(transcript_text)
        logger.info(
            "Transcript pipeline generated idea blocks session_name=%s user_id=%s count=%s",
            session_name,
            user_id,
            len(generated_blocks),
        )
        idea_blocks: list[IdeaBlock] = []
        task_items: list[TaskItem] = []

        for block_data in generated_blocks:
            summary = str(block_data["summary"]).strip()
            content = str(block_data["content"]).strip()
            idea_block = IdeaBlock(
                user_id=user_id,
                session_name=session_name,
                title=_title_from_content(content),
                summary=summary,
                transcript_id=None,
                embedding_vector=await create_text_embedding(summary),
                similarity_id=None,
            )
            db.add(idea_block)
            await db.flush()
            idea_blocks.append(idea_block)

            task_items.extend(
                await generate_and_save_task_items_for_idea_block(
                    db,
                    idea_block_id=idea_block.id,
                    text=summary,
                )
            )

        await db.commit()
        logger.info(
            "Transcript pipeline committed session_name=%s user_id=%s idea_blocks=%s task_items=%s",
            session_name,
            user_id,
            len(idea_blocks),
            len(task_items),
        )
        return PipelineResult(idea_blocks=idea_blocks, task_items=task_items)
    except Exception as exc:
        logger.exception(
            "Transcript pipeline failed session_name=%s user_id=%s error=%s",
            session_name,
            user_id,
            exc,
        )
        await db.rollback()
        raise


async def generate_idea_blocks_with_task_items_from_text(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    visibility: Visibility,
    transcript_text: str,
) -> PipelineResult:
    transcript = StreamTranscript(segment_id="manual", text=transcript_text)
    return await generate_idea_blocks_with_task_items_from_transcripts(
        db,
        session_name=session_name,
        user_id=user_id,
        visibility=visibility,
        transcripts=[transcript],
    )


async def generate_idea_blocks_with_task_items_from_transcript_ids(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    visibility: Visibility,
    transcript_ids: list[int],
) -> PipelineResult:
    if not transcript_ids:
        raise ApiError(400, "INVALID_PAYLOAD", "transcript_ids cannot be empty")

    result = await db.execute(
        select(Transcript)
        .where(
            Transcript.id.in_(transcript_ids),
            Transcript.session_name == session_name,
            Transcript.user_id == user_id,
        )
        .order_by(Transcript.time_stamp.asc(), Transcript.id.asc())
    )
    transcripts = list(result.scalars().all())
    if len(transcripts) != len(set(transcript_ids)):
        raise ApiError(404, "TRANSCRIPT_NOT_FOUND", "One or more transcripts were not found")

    stream_transcripts = [
        StreamTranscript(segment_id=str(item.id), text=item.transcript)
        for item in transcripts
    ]
    return await generate_idea_blocks_with_task_items_from_transcripts(
        db,
        session_name=session_name,
        user_id=user_id,
        visibility=visibility,
        transcripts=stream_transcripts,
    )


def serialize_pipeline_result(result: PipelineResult) -> dict[str, list[dict[str, Any]]]:
    return {
        "idea_blocks": [
            {
                "id": block.id,
                "title": block.title,
                "summary": block.summary,
                "transcript": block.transcript,
                "similarity_id": block.similarity_id,
            }
            for block in result.idea_blocks
        ],
        "task_items": [
            {
                "id": task_item.id,
                "idea_block_id": task_item.idea_block_id,
                "task_item_id": task_item.task_item_id,
            }
            for task_item in result.task_items
        ],
    }


def _title_from_content(content: str) -> str:
    value = content.strip()[:10]
    return value or "Idea"
