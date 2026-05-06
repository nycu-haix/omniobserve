from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import (
    SimilarityCreate,
    SimilarityResponse,
    SimilarityUpdate,
)
from ..services.similarity_service import (
    create_similarity,
    create_session_similarity,
    delete_session_similarity,
    get_session_similarity,
    get_scoped_similarity,
    list_session_similarities,
    list_scoped_similarities,
    update_session_similarity,
)

router = APIRouter(tags=["Similarities"])


@router.post(
    "/sessions/{session_name}/similarities",
    status_code=status.HTTP_201_CREATED,
    response_model=SimilarityResponse,
    summary="Create Session Similarity Pair",
)
async def post_session_similarity(
    session_name: str,
    payload: SimilarityCreate,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await create_session_similarity(payload, session_name=session_name, db=db)


@router.get(
    "/sessions/{session_name}/similarities",
    response_model=list[SimilarityResponse],
    summary="List Session Similarity Pairs",
)
async def read_session_similarities(
    session_name: str,
    db: AsyncSession = Depends(get_db),
) -> list[SimilarityResponse]:
    return await list_session_similarities(session_name=session_name, db=db)


@router.get(
    "/sessions/{session_name}/similarities/{similarity_id}",
    response_model=SimilarityResponse,
    summary="Get Session Similarity Pair By ID",
)
async def read_session_similarity(
    session_name: str,
    similarity_id: int,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await get_session_similarity(similarity_id, session_name=session_name, db=db)


@router.patch(
    "/sessions/{session_name}/similarities/{similarity_id}",
    response_model=SimilarityResponse,
    summary="Update Session Similarity Pair",
)
async def patch_session_similarity(
    session_name: str,
    similarity_id: int,
    payload: SimilarityUpdate,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await update_session_similarity(similarity_id, payload, session_name=session_name, db=db)


@router.delete(
    "/sessions/{session_name}/similarities/{similarity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Session Similarity Pair",
)
async def remove_session_similarity(
    session_name: str,
    similarity_id: int,
    db: AsyncSession = Depends(get_db),
) -> None:
    await delete_session_similarity(similarity_id, session_name=session_name, db=db)


@router.post(
    "/sessions/{session_name}/users/{user_id}/similarities",
    status_code=status.HTTP_201_CREATED,
    response_model=SimilarityResponse,
    summary="Create Similarity Pair",
)
async def post_similarity(
    session_name: str,
    user_id: int,
    payload: SimilarityCreate,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await create_similarity(payload, session_name=session_name, user_id=user_id, db=db)


@router.get(
    "/sessions/{session_name}/users/{user_id}/similarities",
    response_model=list[SimilarityResponse],
    summary="List Similarity Pairs",
)
async def read_similarities(
    session_name: str,
    user_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[SimilarityResponse]:
    return await list_scoped_similarities(session_name=session_name, user_id=user_id, db=db)


@router.get(
    "/sessions/{session_name}/users/{user_id}/similarities/{similarity_id}",
    response_model=SimilarityResponse,
    summary="Get Similarity Pair By ID",
)
async def read_similarity(
    session_name: str,
    user_id: int,
    similarity_id: int,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await get_scoped_similarity(similarity_id, session_name=session_name, user_id=user_id, db=db)
