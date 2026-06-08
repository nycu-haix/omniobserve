from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import IdeaBlock


async def list_session_poster_idea_block_task_items(
    db: AsyncSession,
    *,
    session_name: str,
    user_id: int | None = None,
    idea_block_id: int | None = None,
    include_empty: bool = True,
) -> list[dict]:
    stmt = (
        select(IdeaBlock)
        .options(selectinload(IdeaBlock.poster_task_items))
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.is_deleted.is_(False),
        )
        .order_by(IdeaBlock.id.asc())
    )
    if user_id is not None:
        stmt = stmt.where(IdeaBlock.user_id == user_id)
    if idea_block_id is not None:
        stmt = stmt.where(IdeaBlock.id == idea_block_id)

    result = await db.execute(stmt)
    blocks = list(result.scalars().all())
    responses: list[dict] = []
    for block in blocks:
        task_items = sorted(block.poster_task_items, key=lambda item: item.id)
        if not include_empty and not task_items:
            continue
        responses.append(
            {
                "idea_block_id": block.id,
                "user_id": block.user_id,
                "session_name": block.session_name,
                "task_name": block.task_name,
                "time_stamp": block.time_stamp,
                "title": block.title,
                "summary": block.summary,
                "task_items": task_items,
            }
        )
    return responses

