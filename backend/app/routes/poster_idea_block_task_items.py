from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import PosterIdeaBlockTaskItemsForIdeaBlockResponse
from ..services.poster_idea_block_task_item_service import list_session_poster_idea_block_task_items

router = APIRouter(tags=["Poster Idea Block Task Items"])


@router.get(
    "/sessions/{session_name}/poster-idea-block-task-items",
    response_model=list[PosterIdeaBlockTaskItemsForIdeaBlockResponse],
    summary="List Poster Idea Block Task Item Mappings For Session",
    description=(
        "Debug/read-only endpoint for enhance-the-poster similarity. "
        "Returns each idea block and the LLM-detected poster component/action mappings saved in "
        "poster_idea_block_task_items. Use this to inspect the first similarity filter layer: idea blocks "
        "with the same component_id can become cosine candidates. include_empty=true also shows idea blocks "
        "where no component/action mapping was detected."
    ),
)
async def read_session_poster_idea_block_task_items(
    session_name: str,
    user_id: int | None = Query(None, description="Optional user id filter."),
    idea_block_id: int | None = Query(None, description="Optional idea block id filter."),
    include_empty: bool = Query(True, description="When true, include idea blocks with no detected poster mappings."),
    db: AsyncSession = Depends(get_db),
) -> list[PosterIdeaBlockTaskItemsForIdeaBlockResponse]:
    return await list_session_poster_idea_block_task_items(
        db,
        session_name=session_name,
        user_id=user_id,
        idea_block_id=idea_block_id,
        include_empty=include_empty,
    )
