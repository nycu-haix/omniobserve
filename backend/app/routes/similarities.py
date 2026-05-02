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
    assign_similarity_to_idea_blocks,
    create_similarity,
    get_similarity,
    list_similarities,
)

router = APIRouter(tags=["Similarities"])


@router.post(
    "/similarities",
    status_code=status.HTTP_201_CREATED,
    response_model=SimilarityResponse,
    summary="Create Similarity Cluster",
)
async def post_similarity(
    payload: SimilarityCreate,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await create_similarity(payload, db)


@router.post(
    "/similarities/assign",
    response_model=SimilarityAssignResponse,
    summary="Assign Similarity To Two Idea Blocks",
)
async def assign_similarity(
    payload: SimilarityAssignRequest,
    db: AsyncSession = Depends(get_db),
) -> SimilarityAssignResponse:
    return await assign_similarity_to_idea_blocks(
        payload.idea_block_a_id,
        payload.idea_block_b_id,
        payload.similarity_reason,
        db,
    )


@router.get(
    "/similarities",
    response_model=list[SimilarityResponse],
    summary="List Similarity Clusters",
)
async def read_similarities(
    db: AsyncSession = Depends(get_db),
) -> list[SimilarityResponse]:
    return await list_similarities(db)


@router.get(
    "/similarities/{similarity_id}",
    response_model=SimilarityResponse,
    summary="Get Similarity Cluster By ID",
)
async def read_similarity(
    similarity_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SimilarityResponse:
    return await get_similarity(similarity_id, db)
