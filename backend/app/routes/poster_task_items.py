from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas.poster_task_item import (
    EnhanceThePosterConfigResponse,
    PosterRankingCandidatesResponse,
    PosterTaskItemPatch,
    PosterTaskItemResponse,
    PosterTaskItemsCreateRequest,
    PosterTaskItemsReplaceRequest,
)
from ..services.poster_task_item_service import (
    create_poster_task_items,
    delete_poster_task_item,
    list_ranking_candidates,
    list_session_poster_task_items,
    list_user_poster_task_items,
    replace_poster_task_items,
    update_poster_task_item,
)
from ..task_config.enhance_the_poster import TASK_ID, serialize_enhance_the_poster_config

router = APIRouter(tags=["Poster Task Items"])


@router.get(
    "/tasks/enhance-the-poster/config",
    response_model=EnhanceThePosterConfigResponse,
    summary="Get Enhance The Poster Config",
)
async def get_enhance_the_poster_config() -> dict[str, object]:
    return serialize_enhance_the_poster_config()


@router.post(
    "/sessions/{session_name}/users/{user_id}/poster-task-items",
    status_code=status.HTTP_201_CREATED,
    response_model=list[PosterTaskItemResponse],
    summary="Create Poster Task Items",
)
async def post_poster_task_items(
    session_name: str,
    user_id: int,
    payload: PosterTaskItemsCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> list[PosterTaskItemResponse]:
    return await create_poster_task_items(
        session_name=session_name,
        user_id=user_id,
        payload=payload,
        db=db,
    )


@router.put(
    "/sessions/{session_name}/users/{user_id}/poster-task-items",
    response_model=list[PosterTaskItemResponse],
    summary="Replace Poster Task Items",
)
async def put_poster_task_items(
    session_name: str,
    user_id: int,
    payload: PosterTaskItemsReplaceRequest,
    db: AsyncSession = Depends(get_db),
) -> list[PosterTaskItemResponse]:
    return await replace_poster_task_items(
        session_name=session_name,
        user_id=user_id,
        payload=payload,
        db=db,
    )


@router.get(
    "/sessions/{session_name}/users/{user_id}/poster-task-items",
    response_model=list[PosterTaskItemResponse],
    summary="List User Poster Task Items",
)
async def read_user_poster_task_items(
    session_name: str,
    user_id: int,
    task_name: str = Query(TASK_ID),
    db: AsyncSession = Depends(get_db),
) -> list[PosterTaskItemResponse]:
    return await list_user_poster_task_items(
        session_name=session_name,
        user_id=user_id,
        task_name=task_name,
        db=db,
    )


@router.get(
    "/sessions/{session_name}/poster-task-items/ranking-candidates",
    response_model=PosterRankingCandidatesResponse,
    summary="List Poster Ranking Candidates",
)
async def read_poster_ranking_candidates(
    session_name: str,
    task_name: str = Query(TASK_ID),
    db: AsyncSession = Depends(get_db),
) -> PosterRankingCandidatesResponse:
    shuffle_seed, items = await list_ranking_candidates(
        session_name=session_name,
        task_name=task_name,
        db=db,
    )
    return PosterRankingCandidatesResponse(
        task_name=task_name,
        session_name=session_name,
        shuffle_seed=shuffle_seed,
        items=items,
    )


@router.get(
    "/sessions/{session_name}/poster-task-items",
    response_model=list[PosterTaskItemResponse],
    summary="List Session Poster Task Items",
)
async def read_session_poster_task_items(
    session_name: str,
    task_name: str = Query(TASK_ID),
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[PosterTaskItemResponse]:
    return await list_session_poster_task_items(
        session_name=session_name,
        task_name=task_name,
        user_id=user_id,
        db=db,
    )


@router.patch(
    "/sessions/{session_name}/users/{user_id}/poster-task-items/{id}",
    response_model=PosterTaskItemResponse,
    summary="Update Poster Task Item",
)
async def patch_poster_task_item(
    session_name: str,
    user_id: int,
    id: int,
    payload: PosterTaskItemPatch,
    db: AsyncSession = Depends(get_db),
) -> PosterTaskItemResponse:
    return await update_poster_task_item(
        id=id,
        session_name=session_name,
        user_id=user_id,
        payload=payload,
        db=db,
    )


@router.delete(
    "/sessions/{session_name}/users/{user_id}/poster-task-items/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Poster Task Item",
)
async def remove_poster_task_item(
    session_name: str,
    user_id: int,
    id: int,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_poster_task_item(
        id=id,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
