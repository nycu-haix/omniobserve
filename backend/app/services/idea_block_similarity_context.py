from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import IdeaBlock, Similarity


async def attach_similarity_reason_flags(
    idea_blocks: IdeaBlock | list[IdeaBlock],
    db: AsyncSession,
) -> IdeaBlock | list[IdeaBlock]:
    blocks = [idea_blocks] if isinstance(idea_blocks, IdeaBlock) else list(idea_blocks)
    block_ids = [block.id for block in blocks if block.id is not None]
    if not block_ids:
        for block in blocks:
            block.similarity_is_same_reason = None
            block.similarity_has_same_reason = False
            block.similarity_has_different_reason = False
        return idea_blocks

    result = await db.execute(
        select(Similarity).where(
            or_(
                Similarity.idea_block_id_1.in_(block_ids),
                Similarity.idea_block_id_2.in_(block_ids),
            )
        )
    )
    reason_flags_by_block_id = {
        block_id: {"same": False, "different": False}
        for block_id in block_ids
    }
    for similarity in result.scalars().all():
        for block_id in (similarity.idea_block_id_1, similarity.idea_block_id_2):
            if block_id not in reason_flags_by_block_id:
                continue
            if similarity.is_same_reason:
                reason_flags_by_block_id[block_id]["same"] = True
            else:
                reason_flags_by_block_id[block_id]["different"] = True

    for block in blocks:
        flags = reason_flags_by_block_id.get(block.id, {"same": False, "different": False})
        has_same_reason = flags["same"]
        has_different_reason = flags["different"]
        block.similarity_has_same_reason = has_same_reason
        block.similarity_has_different_reason = has_different_reason
        if has_same_reason == has_different_reason:
            block.similarity_is_same_reason = None
            continue
        block.similarity_is_same_reason = has_same_reason

    return idea_blocks
