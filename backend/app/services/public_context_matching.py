from collections import OrderedDict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock, PosterIdeaBlockTaskItem, TaskItem
from ..task_config import get_task_config_for_session
from .task_item_generation import (
    build_poster_component_ids_with_llm,
    build_task_item_ids_by_keyword,
    build_task_item_ids_with_llm,
)


@dataclass(frozen=True)
class PublicContextMatch:
    idea_block_id: int
    user_id: int
    reason: str
    score: float | None = None
    task_item_ids: list[int] = field(default_factory=list)
    component_ids: list[str] = field(default_factory=list)


async def find_public_context_matches(
    db: AsyncSession,
    *,
    session_name: str,
    public_text: str,
) -> list[PublicContextMatch]:
    normalized_text = public_text.strip()
    if not normalized_text:
        return []

    task_config = get_task_config_for_session(session_name=session_name)
    if task_config.get("task_id") == "enhance-the-poster":
        try:
            component_ids = await build_poster_component_ids_with_llm(normalized_text, session_name=session_name)
        except Exception as exc:
            logger.warning(
                "public_context_component_match_failed session_name=%s error_type=%s error=%s",
                session_name,
                exc.__class__.__name__,
                exc,
            )
            component_ids = []
        if component_ids:
            component_matches = await _find_same_component_matches(
                db,
                session_name=session_name,
                component_ids=component_ids,
            )
            logger.info(
                "public_context_component_match_done session_name=%s component_ids=%s match_count=%s",
                session_name,
                component_ids,
                len(component_matches),
            )
            if component_matches:
                return component_matches

    task_item_ids = build_task_item_ids_by_keyword(normalized_text, session_name=session_name)
    if not task_item_ids:
        try:
            task_item_ids = await build_task_item_ids_with_llm(normalized_text, session_name=session_name)
        except Exception as exc:
            logger.warning(
                "public_context_task_item_match_failed session_name=%s error_type=%s error=%s",
                session_name,
                exc.__class__.__name__,
                exc,
            )
            task_item_ids = []
    if not task_item_ids:
        logger.info(
            "public_context_match_skipped session_name=%s reason=%s text_chars=%s",
            session_name,
            "no_component_or_task_items",
            len(normalized_text),
        )
        return []

    task_item_matches = await _find_same_task_item_matches(
        db,
        session_name=session_name,
        task_item_ids=task_item_ids,
    )
    logger.info(
        "public_context_task_item_match_done session_name=%s task_item_ids=%s match_count=%s",
        session_name,
        task_item_ids,
        len(task_item_matches),
    )
    return task_item_matches


async def find_public_context_component_matches(
    db: AsyncSession,
    *,
    session_name: str,
    component_ids: list[str],
) -> list[PublicContextMatch]:
    normalized_component_ids = []
    seen_component_ids: set[str] = set()
    for component_id in component_ids:
        normalized_component_id = str(component_id or "").strip()
        if not normalized_component_id or normalized_component_id in seen_component_ids:
            continue
        seen_component_ids.add(normalized_component_id)
        normalized_component_ids.append(normalized_component_id)
    if not normalized_component_ids:
        return []
    return await _find_same_component_matches(
        db,
        session_name=session_name,
        component_ids=normalized_component_ids,
    )


async def _find_same_component_matches(
    db: AsyncSession,
    *,
    session_name: str,
    component_ids: list[str],
) -> list[PublicContextMatch]:
    result = await db.execute(
        select(
            IdeaBlock.id,
            IdeaBlock.user_id,
            PosterIdeaBlockTaskItem.component_id,
        )
        .join(PosterIdeaBlockTaskItem, PosterIdeaBlockTaskItem.idea_block_id == IdeaBlock.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.is_deleted.is_(False),
            PosterIdeaBlockTaskItem.component_id.in_(component_ids),
        )
        .order_by(IdeaBlock.id.desc(), PosterIdeaBlockTaskItem.component_id.asc())
    )

    matches_by_block_id: OrderedDict[int, tuple[int, list[str]]] = OrderedDict()
    for idea_block_id, user_id, component_id in result.all():
        block_user_id, block_component_ids = matches_by_block_id.setdefault(
            int(idea_block_id),
            (int(user_id), []),
        )
        if component_id not in block_component_ids:
            block_component_ids.append(str(component_id))
        matches_by_block_id[int(idea_block_id)] = (block_user_id, block_component_ids)

    return [
        PublicContextMatch(
            idea_block_id=idea_block_id,
            user_id=user_id,
            reason="same poster component",
            component_ids=block_component_ids,
        )
        for idea_block_id, (user_id, block_component_ids) in matches_by_block_id.items()
    ]


async def _find_same_task_item_matches(
    db: AsyncSession,
    *,
    session_name: str,
    task_item_ids: list[int],
) -> list[PublicContextMatch]:
    result = await db.execute(
        select(
            IdeaBlock.id,
            IdeaBlock.user_id,
            TaskItem.task_item_id,
        )
        .join(TaskItem, TaskItem.idea_block_id == IdeaBlock.id)
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.is_deleted.is_(False),
            TaskItem.task_item_id.in_(task_item_ids),
        )
        .order_by(IdeaBlock.id.desc(), TaskItem.task_item_id.asc())
    )

    matches_by_block_id: OrderedDict[int, tuple[int, list[int]]] = OrderedDict()
    for idea_block_id, user_id, task_item_id in result.all():
        block_user_id, block_task_item_ids = matches_by_block_id.setdefault(
            int(idea_block_id),
            (int(user_id), []),
        )
        normalized_task_item_id = int(task_item_id)
        if normalized_task_item_id not in block_task_item_ids:
            block_task_item_ids.append(normalized_task_item_id)
        matches_by_block_id[int(idea_block_id)] = (block_user_id, block_task_item_ids)

    return [
        PublicContextMatch(
            idea_block_id=idea_block_id,
            user_id=user_id,
            reason="same task item",
            task_item_ids=block_task_item_ids,
        )
        for idea_block_id, (user_id, block_task_item_ids) in matches_by_block_id.items()
    ]
