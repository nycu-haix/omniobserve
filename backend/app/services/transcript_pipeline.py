import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import logger
from ..db import SessionLocal
from ..models import IdeaBlock, TaskItem, Transcript, Visibility
from ..schemas import ApiError, StreamTranscript
from ..task_config import resolve_task_id
from .embedding_service import create_text_embedding
from .idea_blocks import build_idea_blocks_with_llm
from .idea_block_deduplication import find_duplicate_idea_block
from .idea_block_similarity_context import attach_similarity_reason_flags
from .similarity_detection import trigger_similarity_detection
from .task_item_generation import build_task_item_ids_with_llm, save_task_items_for_idea_block_ids

IdeaBlockUpdateCallback = Callable[[list[IdeaBlock]], Awaitable[None]]
ProvisionalIdeaBlockUpdateCallback = Callable[[list[dict[str, Any]]], Awaitable[None]]


@dataclass
class PipelineResult:
    idea_blocks: list[IdeaBlock]
    task_items: list[TaskItem]
    duplicate_idea_blocks: list[IdeaBlock] = field(default_factory=list)


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
    task_name: str | None = None,
    on_similarity_update: IdeaBlockUpdateCallback | None = None,
    on_provisional_idea_blocks_update: ProvisionalIdeaBlockUpdateCallback | None = None,
) -> PipelineResult | None:
    key = (session_name, user_id)
    logger.info(
        "pipeline_handle_segment_enter session_name=%s user_id=%s has_transcript=%s is_final=%s visibility=%s",
        session_name,
        user_id,
        transcript is not None,
        is_final,
        visibility.value,
    )

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
            logger.info(
                "pipeline_waiting_for_final session_name=%s user_id=%s pending=%s",
                session_name,
                user_id,
                len(_pending_transcripts[key]),
            )
            return None

        transcripts = list(_pending_transcripts.pop(key, []))
        logger.info(
            "pipeline_buffer_flush session_name=%s user_id=%s segment_count=%s",
            session_name,
            user_id,
            len(transcripts),
        )

    if not transcripts:
        logger.info(
            "pipeline_skip_no_pending_transcripts session_name=%s user_id=%s",
            session_name,
            user_id,
        )
        return None

    return await generate_idea_blocks_with_task_items_from_transcripts(
        db,
        session_name=session_name,
        user_id=user_id,
        visibility=visibility,
        transcripts=transcripts,
        task_name=task_name,
        on_similarity_update=on_similarity_update,
        on_provisional_idea_blocks_update=on_provisional_idea_blocks_update,
    )


async def generate_idea_blocks_with_task_items_from_transcripts(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    visibility: Visibility,
    transcripts: list[StreamTranscript],
    task_name: str | None = None,
    on_similarity_update: IdeaBlockUpdateCallback | None = None,
    on_provisional_idea_blocks_update: ProvisionalIdeaBlockUpdateCallback | None = None,
) -> PipelineResult:
    resolved_task_name = resolve_task_id(session_name=session_name, task_id=task_name)
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
        generated_blocks = await build_idea_blocks_with_llm(transcript_text, session_name=session_name, task_name=resolved_task_name)
        logger.info(
            "pipeline_idea_llm_done session_name=%s user_id=%s count=%s",
            session_name,
            user_id,
            len(generated_blocks),
        )
        if generated_blocks and on_provisional_idea_blocks_update is not None:
            provisional_idea_blocks = serialize_provisional_idea_blocks(
                generated_blocks,
                transcript_text=transcript_text,
                transcript_id=main_transcript_id,
            )
            try:
                await on_provisional_idea_blocks_update(provisional_idea_blocks)
                logger.info(
                    "pipeline_provisional_idea_blocks_sent session_name=%s user_id=%s count=%s",
                    session_name,
                    user_id,
                    len(provisional_idea_blocks),
                )
            except Exception as exc:
                logger.warning(
                    "pipeline_provisional_idea_blocks_send_failed session_name=%s user_id=%s error=%s",
                    session_name,
                    user_id,
                    exc,
                )
        idea_blocks: list[IdeaBlock] = []
        task_items: list[TaskItem] = []
        duplicate_idea_blocks: list[IdeaBlock] = []

        for block_index, block_data in enumerate(generated_blocks, start=1):
            summary = str(block_data["summary"]).strip()
            content = str(block_data["content"]).strip()
            logger.info(
                "pipeline_block_start session_name=%s user_id=%s block_index=%s summary_chars=%s content_chars=%s",
                session_name,
                user_id,
                block_index,
                len(summary),
                len(content),
            )
            logger.info(
                "pipeline_embedding_start session_name=%s user_id=%s block_index=%s summary_chars=%s",
                session_name,
                user_id,
                block_index,
                len(summary),
            )
            embedding_vector = await _create_embedding_or_none(
                summary,
                session_name=session_name,
                user_id=user_id,
                block_index=block_index,
            )
            title = _title_from_content(content)
            logger.info(
                "pipeline_task_item_ids_start session_name=%s user_id=%s block_index=%s summary_chars=%s",
                session_name,
                user_id,
                block_index,
                len(summary),
            )
            task_item_ids = await build_task_item_ids_with_llm(summary, session_name=session_name, task_name=resolved_task_name)
            logger.info(
                "pipeline_task_item_ids_done session_name=%s user_id=%s block_index=%s task_item_ids=%s",
                session_name,
                user_id,
                block_index,
                task_item_ids,
            )
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
                        "pipeline_block_deduplicated session_name=%s user_id=%s block_index=%s "
                        "duplicate_id=%s reason=%s similarity=%s"
                    ),
                    session_name,
                    user_id,
                    block_index,
                    duplicate_match.idea_block_id,
                    duplicate_match.reason,
                    duplicate_match.similarity,
                )
                duplicate_block = await get_idea_block_for_payload(duplicate_match.idea_block_id, db)
                if duplicate_block is not None:
                    duplicate_block._duplicate_of_id = duplicate_match.idea_block_id
                    duplicate_block._duplicate_reason = duplicate_match.reason
                    duplicate_block._duplicate_similarity = duplicate_match.similarity
                    duplicate_idea_blocks.append(duplicate_block)
                continue

            idea_block = IdeaBlock(
                user_id=user_id,
                session_name=session_name,
                task_name=resolved_task_name,
                title=title,
                summary=summary,
                transcript_id=main_transcript_id,
                embedding_vector=embedding_vector,
                similarity_id=None,
            )
            db.add(idea_block)
            await db.flush()
            idea_blocks.append(idea_block)
            logger.info(
                "pipeline_idea_block_saved session_name=%s user_id=%s block_index=%s idea_block_id=%s transcript_id=%s",
                session_name,
                user_id,
                block_index,
                idea_block.id,
                idea_block.transcript_id,
            )

            logger.info(
                "pipeline_task_items_start session_name=%s user_id=%s block_index=%s idea_block_id=%s",
                session_name,
                user_id,
                block_index,
                idea_block.id,
            )
            task_item_count_before = len(task_items)
            task_items.extend(
                await save_task_items_for_idea_block_ids(
                    db,
                    idea_block_id=idea_block.id,
                    task_item_ids=task_item_ids,
                    session_name=session_name,
                    task_name=resolved_task_name,
                    text=summary,
                )
            )
            logger.info(
                "pipeline_task_items_done session_name=%s user_id=%s block_index=%s idea_block_id=%s block_task_items=%s total_task_items=%s",
                session_name,
                user_id,
                block_index,
                idea_block.id,
                len(task_items) - task_item_count_before,
                len(task_items),
            )
            logger.info(
                "pipeline_block_done session_name=%s user_id=%s block_index=%s idea_block_id=%s",
                session_name,
                user_id,
                block_index,
                idea_block.id,
            )

        logger.info(
            "pipeline_commit_start session_name=%s user_id=%s idea_blocks=%s task_items=%s",
            session_name,
            user_id,
            len(idea_blocks),
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
        _schedule_similarity_detection(
            idea_block_ids=[idea_block.id for idea_block in idea_blocks],
            on_similarity_update=on_similarity_update,
        )
        return PipelineResult(
            idea_blocks=idea_blocks,
            task_items=task_items,
            duplicate_idea_blocks=duplicate_idea_blocks,
        )
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
    task_name: str | None = None,
    on_similarity_update: IdeaBlockUpdateCallback | None = None,
    on_provisional_idea_blocks_update: ProvisionalIdeaBlockUpdateCallback | None = None,
) -> PipelineResult:
    transcript = StreamTranscript(segment_id="manual", text=transcript_text)
    return await generate_idea_blocks_with_task_items_from_transcripts(
        db,
        session_name=session_name,
        user_id=user_id,
        visibility=visibility,
        transcripts=[transcript],
        task_name=task_name,
        on_similarity_update=on_similarity_update,
        on_provisional_idea_blocks_update=on_provisional_idea_blocks_update,
    )


async def generate_idea_blocks_with_task_items_from_transcript_ids(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int,
    visibility: Visibility,
    transcript_ids: list[int],
    task_name: str | None = None,
    on_similarity_update: IdeaBlockUpdateCallback | None = None,
    on_provisional_idea_blocks_update: ProvisionalIdeaBlockUpdateCallback | None = None,
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
        task_name=task_name,
        on_similarity_update=on_similarity_update,
        on_provisional_idea_blocks_update=on_provisional_idea_blocks_update,
    )


def serialize_pipeline_result(result: PipelineResult) -> dict[str, list[dict[str, Any]]]:
    return {
        "idea_blocks": serialize_idea_blocks(result.idea_blocks),
        "duplicate_idea_blocks": serialize_idea_blocks(result.duplicate_idea_blocks),
        "task_items": [
            {
                "id": task_item.id,
                "idea_block_id": task_item.idea_block_id,
                "task_item_id": task_item.task_item_id,
            }
            for task_item in result.task_items
        ],
    }


def serialize_provisional_idea_blocks(
    generated_blocks: list[dict[str, str]],
    *,
    transcript_text: str,
    transcript_id: int | None,
) -> list[dict[str, Any]]:
    return [
        {
            "id": f"provisional-{index}",
            "provisional_id": f"provisional-{index}",
            "index": index,
            "title": _title_from_content(str(block.get("content", ""))),
            "summary": str(block.get("summary", "")).strip(),
            "transcript_id": transcript_id,
            "transcript": transcript_text,
            "is_provisional": True,
        }
        for index, block in enumerate(generated_blocks, start=1)
        if str(block.get("summary", "")).strip()
    ]


def serialize_idea_blocks(idea_blocks: list[IdeaBlock]) -> list[dict[str, Any]]:
    return [
        {
            "id": block.id,
            "user_id": block.user_id,
            "title": block.title,
            "summary": block.summary,
            "time_stamp": block.time_stamp.isoformat() if block.time_stamp else None,
            "transcript_id": block.transcript_id,
            "transcript": block.transcript,
            "similarity_id": block.similarity_id,
            "similarity_is_same_reason": block.similarity_is_same_reason,
            "similarity_has_same_reason": block.similarity_has_same_reason,
            "similarity_has_different_reason": block.similarity_has_different_reason,
            "is_deleted": block.is_deleted,
            "is_duplicate": block.is_duplicate,
            "duplicate_of_id": block.duplicate_of_id,
            "duplicate_reason": block.duplicate_reason,
            "duplicate_similarity": block.duplicate_similarity,
        }
        for block in idea_blocks
    ]


async def get_idea_block_for_payload(idea_block_id: int, db: AsyncSession) -> IdeaBlock | None:
    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.main_transcript))
        .where(IdeaBlock.id == idea_block_id)
    )
    idea_block = result.scalar_one_or_none()
    if idea_block is not None:
        await attach_similarity_reason_flags(idea_block, db)
    return idea_block


async def _create_embedding_or_none(
    text: str,
    *,
    session_name: str,
    user_id: int,
    block_index: int,
) -> list[float] | None:
    try:
        embedding_vector = await create_text_embedding(text)
        logger.info(
            "pipeline_embedding_done session_name=%s user_id=%s block_index=%s dimensions=%s",
            session_name,
            user_id,
            block_index,
            len(embedding_vector),
        )
        return embedding_vector
    except HTTPException as exc:
        if exc.status_code < 500:
            raise
        logger.warning(
            (
                "pipeline_embedding_skipped reason=embedding_provider_error session_name=%s "
                "user_id=%s block_index=%s status=%s detail=%s"
            ),
            session_name,
            user_id,
            block_index,
            exc.status_code,
            exc.detail,
        )
        return None


def _title_from_content(content: str) -> str:
    value = content.strip()[:20]
    return value or "Idea"


def _main_transcript_id_from_batch(transcripts: list[StreamTranscript]) -> int | None:
    for transcript in reversed(transcripts):
        try:
            return int(transcript.segment_id)
        except (TypeError, ValueError):
            continue
    return None


def _schedule_similarity_detection(
    *,
    idea_block_ids: list[int],
    on_similarity_update: IdeaBlockUpdateCallback | None,
) -> None:
    if not idea_block_ids:
        logger.info("similarity_detection_background_skipped reason=%s", "no_idea_blocks")
        return

    async def run_detection() -> None:
        try:
            updated_blocks: list[IdeaBlock] = []
            async with SessionLocal() as detection_db:
                for idea_block_id in idea_block_ids:
                    await trigger_similarity_detection(idea_block_id, detection_db)
                    idea_block = await get_idea_block_for_payload(idea_block_id, detection_db)
                    if idea_block is not None:
                        updated_blocks.append(idea_block)

            if updated_blocks and on_similarity_update is not None:
                await on_similarity_update(updated_blocks)
        except Exception as exc:
            logger.exception(
                "similarity_detection_background_failed idea_block_ids=%s error_type=%s error=%s",
                idea_block_ids,
                exc.__class__.__name__,
                exc,
            )

    logger.info("similarity_detection_background_scheduled idea_block_ids=%s", idea_block_ids)
    asyncio.create_task(run_detection())
