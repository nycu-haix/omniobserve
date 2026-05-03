from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import (
    SimilarityAssignRequest,
    SimilarityAssignResponse,
    SimilarityCreate,
    SimilarityResponse,
)
from ..services.similarity_service import (
    assign_scoped_similarity_to_idea_blocks,
    create_similarity,
    get_scoped_similarity,
    list_scoped_similarities,
)

router = APIRouter(tags=["Similarities"])


@router.post(
    "/sessions/{session_name}/users/{user_id}/similarities",
    status_code=status.HTTP_201_CREATED,
    response_model=SimilarityResponse,
    summary="Create Similarity Cluster",
)
async def post_similarity(
    session_name: str,
    user_id: int,
    payload: SimilarityCreate,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await create_similarity(payload, db)


@router.post(
    "/sessions/{session_name}/users/{user_id}/similarities/assign",
    response_model=SimilarityAssignResponse,
    summary="Assign Similarity To Two Idea Blocks",
)
async def assign_similarity(
    session_name: str,
    user_id: int,
    payload: SimilarityAssignRequest,
    db: AsyncSession = Depends(get_db),
) -> SimilarityAssignResponse:
    return await assign_scoped_similarity_to_idea_blocks(
        payload.idea_block_a_id,
        payload.idea_block_b_id,
        payload.similarity_reason,
        session_name=session_name,
        user_id=user_id,
        db=db,
    )


@router.get(
    "/sessions/{session_name}/users/{user_id}/similarities",
    response_model=list[SimilarityResponse],
    summary="List Similarity Clusters",
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
    summary="Get Similarity Cluster By ID",
)
async def read_similarity(
    session_name: str,
    user_id: int,
    similarity_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await get_scoped_similarity(similarity_id, session_name=session_name, user_id=user_id, db=db)
