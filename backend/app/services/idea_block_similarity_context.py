from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdeaBlock, Similarity


async def attach_similarity_reason_flags(
    idea_blocks: IdeaBlock | list[IdeaBlock],
    db: AsyncSession,
) -> IdeaBlock | list[IdeaBlock]:
    blocks = [idea_blocks] if isinstance(idea_blocks, IdeaBlock) else list(idea_blocks)
    pair_keys = [
        (block.id, block.similarity_id)
        for block in blocks
        if block.id is not None and block.similarity_id is not None
    ]
    if not pair_keys:
        for block in blocks:
            block.similarity_is_same_reason = None
        return idea_blocks

    result = await db.execute(
        select(Similarity).where(
            or_(
                *[
                    or_(
                        and_(
                            Similarity.idea_block_id_1 == idea_block_id,
                            Similarity.idea_block_id_2 == similar_idea_block_id,
                        ),
                        and_(
                            Similarity.idea_block_id_1 == similar_idea_block_id,
                            Similarity.idea_block_id_2 == idea_block_id,
                        ),
                    )
                    for idea_block_id, similar_idea_block_id in pair_keys
                ]
            )
        )
    )
    flags_by_pair = {
        frozenset((similarity.idea_block_id_1, similarity.idea_block_id_2)): similarity.is_same_reason
        for similarity in result.scalars().all()
    }
    for block in blocks:
        if block.similarity_id is None:
            block.similarity_is_same_reason = None
            continue
        block.similarity_is_same_reason = flags_by_pair.get(frozenset((block.id, block.similarity_id)))

    return idea_blocks
