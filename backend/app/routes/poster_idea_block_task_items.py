from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import PosterIdeaBlockTaskItemsForIdeaBlockResponse
from ..services.poster_idea_block_task_item_service import list_session_poster_idea_block_task_items

router = APIRouter(tags=["Poster Idea Block Task Items"])


@router.get(
    "/sessions/{session_name}/poster-idea-block-task-items",
    response_model=list[PosterIdeaBlockTaskItemsForIdeaBlockResponse],
    summary="List Poster Idea Block Task Item Mappings For Session",
)
async def read_session_poster_idea_block_task_items(
    session_name: str,
    user_id: int | None = None,
    idea_block_id: int | None = None,
    include_empty: bool = True,
    db: AsyncSession = Depends(get_db),
) -> list[PosterIdeaBlockTaskItemsForIdeaBlockResponse]:
    return await list_session_poster_idea_block_task_items(
        db,
        session_name=session_name,
        user_id=user_id,
        idea_block_id=idea_block_id,
        include_empty=include_empty,
    )

