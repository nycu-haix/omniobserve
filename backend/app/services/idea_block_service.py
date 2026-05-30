import asyncio

from fastapi import HTTPException
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import logger
from ..db import SessionLocal
from ..models import IdeaBlock, IdeaBlockToTranscript, Similarity, TaskItem, Transcript
from ..schemas import ApiError, IdeaBlockCreate, IdeaBlockUpdate
from ..task_config.registry import normalize_task_name
from .embedding_service import create_text_embedding
from .idea_block_deduplication import find_duplicate_idea_block
from .idea_block_similarity_context import attach_similarity_reason_flags
from .idea_blocks import build_idea_blocks_with_llm
from .similarity_detection import trigger_similarity_detection
from .task_item_generation import replace_task_items_for_idea_block


async def create_idea_block_from_content(
    *,
    session_name: str,
    user_id: int,
    task_name: str,
    content: str,
    transcript_id: int | None,
    db: AsyncSession,
) -> IdeaBlock:
    task_name = normalize_task_name(task_name)
    normalized_content = content.strip()
    if not normalized_content:
        raise ApiError(400, "INVALID_PAYLOAD", "content cannot be empty")

    generated_blocks = await build_idea_blocks_with_llm(normalized_content, task_name=task_name)
    if not generated_blocks:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea block could not be generated")

    generated_block = generated_blocks[0]
    generated_content = str(generated_block["content"]).strip()
    summary = str(generated_block["summary"]).strip()
    if not summary:
        raise ApiError(422, "IDEA_GENERATION_FAILED", "Idea block summary could not be generated")

    return await create_idea_block(
        IdeaBlockCreate(
            session_name=session_name,
            user_id=user_id,
            task_name=task_name,
            title=_title_from_content(generated_content or summary),
            summary=summary,
            transcript_id=transcript_id,
        ),
        db,
    )


async def create_idea_block(payload: IdeaBlockCreate, db: AsyncSession) -> IdeaBlock:
    normalize_task_name(payload.task_name)
    if payload.transcript_id is not None and await db.get(Transcript, payload.transcript_id) is None:
        raise HTTPException(status_code=404, detail="Transcript not found")

    idea_block_data = payload.model_dump()
    idea_block_data["embedding_vector"] = await _create_embedding_or_none(payload.summary)
    duplicate_match = await find_duplicate_idea_block(
        db,
        session_name=payload.session_name,
        user_id=payload.user_id,
        task_name=payload.task_name,
        title=payload.title,
        summary=payload.summary,
        embedding_vector=idea_block_data["embedding_vector"],
    )
    if duplicate_match is not None:
        logger.info(
            (
                "idea_block_create_deduplicated session_name=%s user_id=%s "
                "duplicate_id=%s reason=%s similarity=%s"
            ),
            payload.session_name,
            payload.user_id,
            duplicate_match.idea_block_id,
            duplicate_match.reason,
            duplicate_match.similarity,
        )
        return await get_idea_block(duplicate_match.idea_block_id, db)

    idea_block = IdeaBlock(**idea_block_data, similarity_id=None)
    db.add(idea_block)
    await db.commit()
    _schedule_task_item_refresh_and_similarity_detection(idea_block.id, payload.summary)
    return await get_idea_block(idea_block.id, db)


def _title_from_content(content: str) -> str:
    value = content.strip()[:10]
    return value or "Idea"


async def get_idea_block(idea_block_id: int, db: AsyncSession) -> IdeaBlock:
    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.main_transcript))
        .where(IdeaBlock.id == idea_block_id)
    )
    idea_block = result.scalar_one_or_none()
    if idea_block is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    await attach_similarity_reason_flags(idea_block, db)
    return idea_block


async def get_scoped_idea_block(
    idea_block_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> IdeaBlock:
    result = await db.execute(
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.main_transcript))
        .where(
            IdeaBlock.id == idea_block_id,
            IdeaBlock.session_name == session_name,
            IdeaBlock.user_id == user_id,
        )
    )
    idea_block = result.scalar_one_or_none()
    if idea_block is None:
        raise HTTPException(status_code=404, detail="Idea block not found")
    await attach_similarity_reason_flags(idea_block, db)
    return idea_block


async def list_idea_blocks(
    db: AsyncSession,
    *,
    user_id: int | None = None,
    session_name: str | None = None,
    similarity_id: int | None = None,
) -> list[IdeaBlock]:
    stmt = select(IdeaBlock).options(selectinload(IdeaBlock.main_transcript))
    if user_id is not None:
        stmt = stmt.where(IdeaBlock.user_id == user_id)
    if session_name is not None:
        stmt = stmt.where(IdeaBlock.session_name == session_name)
    if similarity_id is not None:
        stmt = stmt.where(IdeaBlock.similarity_id == similarity_id)
    stmt = stmt.order_by(IdeaBlock.is_deleted.desc(), IdeaBlock.time_stamp.asc(), IdeaBlock.id.asc())
    result = await db.execute(stmt)
    idea_blocks = list(result.scalars().all())
    await attach_similarity_reason_flags(idea_blocks, db)
    return idea_blocks


async def update_idea_block(
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    db: AsyncSession,
) -> IdeaBlock:
    idea_block = await get_idea_block(idea_block_id, db)
    if idea_block.is_deleted:
        raise HTTPException(status_code=409, detail="Deleted idea blocks cannot be edited")

    update_data = payload.model_dump(exclude_unset=True)
    summary_changed = "summary" in update_data and update_data["summary"] is not None
    if "similarity_id" in update_data and update_data["similarity_id"] is not None:
        if await db.get(IdeaBlock, update_data["similarity_id"]) is None:
            raise HTTPException(status_code=404, detail="Similar idea block not found")

    if "transcript" in update_data:
        transcript_text = update_data.pop("transcript")
        transcript_value = "" if transcript_text is None else str(transcript_text).strip()
        if idea_block.main_transcript is None:
            transcript = Transcript(
                user_id=idea_block.user_id,
                session_name=idea_block.session_name,
                transcript=transcript_value,
            )
            db.add(transcript)
            await db.flush()
            idea_block.transcript_id = transcript.id
            idea_block.main_transcript = transcript
        else:
            idea_block.main_transcript.transcript = transcript_value

    if summary_changed:
        update_data["embedding_vector"] = await _create_embedding_or_none(update_data["summary"])

    for field, value in update_data.items():
        setattr(idea_block, field, value)

    await db.commit()
    if summary_changed:
        _schedule_task_item_refresh_and_similarity_detection(idea_block_id, update_data["summary"])
    return await get_idea_block(idea_block_id, db)


async def update_scoped_idea_block(
    idea_block_id: int,
    payload: IdeaBlockUpdate,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> IdeaBlock:
    idea_block = await get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    if idea_block.is_deleted:
        raise HTTPException(status_code=409, detail="Deleted idea blocks cannot be edited")

    update_data = payload.model_dump(exclude_unset=True)
    summary_changed = "summary" in update_data and update_data["summary"] is not None
    if "similarity_id" in update_data and update_data["similarity_id"] is not None:
        if await db.get(IdeaBlock, update_data["similarity_id"]) is None:
            raise HTTPException(status_code=404, detail="Similar idea block not found")

    if "transcript" in update_data:
        transcript_text = update_data.pop("transcript")
        transcript_value = "" if transcript_text is None else str(transcript_text).strip()
        if idea_block.main_transcript is None:
            transcript = Transcript(
                user_id=idea_block.user_id,
                session_name=idea_block.session_name,
                transcript=transcript_value,
            )
            db.add(transcript)
            await db.flush()
            idea_block.transcript_id = transcript.id
            idea_block.main_transcript = transcript
        else:
            idea_block.main_transcript.transcript = transcript_value

    if summary_changed:
        update_data["embedding_vector"] = await _create_embedding_or_none(update_data["summary"])

    for field, value in update_data.items():
        setattr(idea_block, field, value)

    await db.commit()

    if summary_changed:
        _schedule_task_item_refresh_and_similarity_detection(idea_block_id, update_data["summary"])

    return await get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )


async def delete_idea_block(idea_block_id: int, db: AsyncSession) -> None:
    idea_block = await get_idea_block(idea_block_id, db)
    idea_block.is_deleted = True
    await db.commit()


async def _create_embedding_or_none(text: str) -> list[float] | None:
    try:
        return await create_text_embedding(text)
    except HTTPException as exc:
        if exc.status_code < 500:
            raise
        logger.warning(
            "idea_block_embedding_skipped status=%s detail=%s",
            exc.status_code,
            exc.detail,
        )
        return None


async def delete_scoped_idea_block(
    idea_block_id: int,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    idea_block = await get_scoped_idea_block(
        idea_block_id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    idea_block.is_deleted = True
    await db.commit()


async def _delete_similarity_references(idea_block_id: int, db: AsyncSession) -> None:
    await db.execute(
        delete(Similarity).where(
            or_(
                Similarity.idea_block_id_1 == idea_block_id,
                Similarity.idea_block_id_2 == idea_block_id,
            )
        )
    )
    await db.execute(
        update(IdeaBlock)
        .where(IdeaBlock.similarity_id == idea_block_id)
        .values(similarity_id=None)
    )


async def trigger_similarity_check(
    updated_idea_block: IdeaBlock,
    *,
    session_name: str,
    user_id: int,
    db: AsyncSession,
) -> None:
    """
    Placeholder hook for similarity re-detection after create/update.
    """
    _ = (updated_idea_block, session_name, user_id, db)


async def _refresh_task_items_and_detect_similarity(
    idea_block_id: int,
    summary: str,
    db: AsyncSession,
) -> None:
    try:
        idea_block = await db.get(IdeaBlock, idea_block_id)
        if idea_block is None:
            logger.info("similarity_detection_task_item_refresh_skipped idea_block_id=%s reason=not_found", idea_block_id)
            return
        logger.info(
            "similarity_detection_task_item_refresh_start idea_block_id=%s summary_chars=%s",
            idea_block_id,
            len(summary),
        )
        await replace_task_items_for_idea_block(
            db,
            idea_block_id=idea_block_id,
            text=summary,
            task_name=idea_block.task_name,
        )
        await db.commit()
        logger.info(
            "similarity_detection_task_item_refresh_done idea_block_id=%s",
            idea_block_id,
        )
    except Exception as exc:
        logger.exception(
            "similarity_detection_task_item_refresh_failed idea_block_id=%s error_type=%s error=%s",
            idea_block_id,
            exc.__class__.__name__,
            exc,
        )
        await db.rollback()
        return

    await trigger_similarity_detection(idea_block_id, db)


def _schedule_task_item_refresh_and_similarity_detection(idea_block_id: int, summary: str) -> None:
    async def run_refresh_and_detection() -> None:
        try:
            async with SessionLocal() as detection_db:
                await _refresh_task_items_and_detect_similarity(idea_block_id, summary, detection_db)
        except Exception as exc:
            logger.exception(
                "similarity_detection_background_failed idea_block_id=%s error_type=%s error=%s",
                idea_block_id,
                exc.__class__.__name__,
                exc,
            )

    logger.info("similarity_detection_background_scheduled idea_block_ids=%s", [idea_block_id])
    asyncio.create_task(run_refresh_and_detection())
