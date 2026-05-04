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
                "pipeline_buffer_append session_name=%s user_id=%s segment_id=%s is_final=%s pending=%s",
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
            "pipeline_buffer_flush session_name=%s user_id=%s segment_count=%s",
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
            "pipeline_skip_empty_batch session_name=%s user_id=%s",
            session_name,
            user_id,
        )
        return PipelineResult(idea_blocks=[], task_items=[])

    main_transcript_id = _main_transcript_id_from_batch(transcripts)
    logger.info(
        "pipeline_main_transcript_selected session_name=%s user_id=%s transcript_id=%s transcript_count=%s",
        session_name,
        user_id,
        main_transcript_id,
        len(transcripts),
    )

    try:
        logger.info(
            "pipeline_generation_started session_name=%s user_id=%s transcript_count=%s transcript_chars=%s",
            session_name,
            user_id,
            len(transcripts),
            len(transcript_text),
        )
        logger.info(
            "pipeline_idea_llm_start session_name=%s user_id=%s transcript_chars=%s",
            session_name,
            user_id,
            len(transcript_text),
        )
        generated_blocks = await build_idea_blocks_with_llm(transcript_text)
        logger.info(
            "pipeline_idea_llm_done session_name=%s user_id=%s count=%s",
            session_name,
            user_id,
            len(generated_blocks),
        )
        idea_blocks: list[IdeaBlock] = []
        task_items: list[TaskItem] = []

        for block_data in generated_blocks:
            summary = str(block_data["summary"]).strip()
            content = str(block_data["content"]).strip()
            logger.info(
                "pipeline_embedding_start session_name=%s user_id=%s summary_chars=%s",
                session_name,
                user_id,
                len(summary),
            )
            embedding_vector = await create_text_embedding(summary)
            logger.info(
                "pipeline_embedding_done session_name=%s user_id=%s dimensions=%s",
                session_name,
                user_id,
                len(embedding_vector),
            )
            idea_block = IdeaBlock(
                user_id=user_id,
                session_name=session_name,
                title=_title_from_content(content),
                summary=summary,
                transcript_id=main_transcript_id,
                embedding_vector=embedding_vector,
                similarity_id=None,
            )
            db.add(idea_block)
            await db.flush()
            idea_blocks.append(idea_block)
            logger.info(
                "pipeline_idea_block_saved session_name=%s user_id=%s idea_block_id=%s transcript_id=%s",
                session_name,
                user_id,
                idea_block.id,
                idea_block.transcript_id,
            )

            logger.info(
                "pipeline_task_items_start session_name=%s user_id=%s idea_block_id=%s",
                session_name,
                user_id,
                idea_block.id,
            )
            task_items.extend(
                await generate_and_save_task_items_for_idea_block(
                    db,
                    idea_block_id=idea_block.id,
                    text=summary,
                )
            )
            logger.info(
                "pipeline_task_items_done session_name=%s user_id=%s idea_block_id=%s total_task_items=%s",
                session_name,
                user_id,
                idea_block.id,
                len(task_items),
            )

        await db.commit()
        logger.info(
            "pipeline_commit_done session_name=%s user_id=%s idea_blocks=%s task_items=%s",
            session_name,
            user_id,
            len(idea_blocks),
            len(task_items),
        )
        return PipelineResult(idea_blocks=idea_blocks, task_items=task_items)
    except Exception as exc:
        logger.exception(
            "pipeline_generation_failed session_name=%s user_id=%s error=%s",
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


def _main_transcript_id_from_batch(transcripts: list[StreamTranscript]) -> int | None:
    for transcript in reversed(transcripts):
        try:
            return int(transcript.segment_id)
        except (TypeError, ValueError):
            continue
    return None
