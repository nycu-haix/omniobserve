import time

from ..config import logger
from ..models import IdeaBlock, Similarity
from .realtime import board_manager


async def notify_similarity_cue(similarity: Similarity) -> None:
    idea_a = similarity.idea_block_1
    idea_b = similarity.idea_block_2
    if idea_a.session_name != idea_b.session_name:
        return

    await send_similarity_cue(
        session_name=idea_a.session_name,
        participant_id=str(idea_a.user_id),
        own_block=idea_a,
        other_block=idea_b,
        similarity_id=similarity.id,
        is_same_reason=similarity.is_same_reason,
    )
    await send_similarity_cue(
        session_name=idea_b.session_name,
        participant_id=str(idea_b.user_id),
        own_block=idea_b,
        other_block=idea_a,
        similarity_id=similarity.id,
        is_same_reason=similarity.is_same_reason,
    )


async def send_similarity_cue(
    *,
    session_name: str,
    participant_id: str,
    own_block: IdeaBlock,
    other_block: IdeaBlock,
    similarity_id: int,
    is_same_reason: bool,
) -> None:
    update_sent = await board_manager.send_to(
        session_name,
        participant_id,
        {
            "type": "update_idea_block",
            "payload": {"id": str(own_block.id)},
        },
    )
    cue_sent = await board_manager.send_to(
        session_name,
        participant_id,
        {
            "type": "similarity_cue",
            "payload": {
                "id": f"similarity-{similarity_id}-{own_block.id}-{int(time.time() * 1000)}",
                "blockId": str(own_block.id),
                "blockSummary": other_block.title or other_block.summary,
                "isSameReason": is_same_reason,
            },
        },
    )
    logger.info(
        "similarity_cue_notify session_name=%s participant_id=%s own_block_id=%s other_block_id=%s similarity_id=%s is_same_reason=%s update_sent=%s cue_sent=%s",
        session_name,
        participant_id,
        own_block.id,
        other_block.id,
        similarity_id,
        is_same_reason,
        update_sent,
        cue_sent,
    )
