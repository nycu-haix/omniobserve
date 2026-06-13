import time
from dataclasses import dataclass
from typing import Literal

from ..config import logger
from ..db import SessionLocal
from ..models import IdeaBlock, Similarity
from .realtime import board_manager, get_session_cue_condition, get_session_phase, is_similarity_cue_enabled
from .similarity_cue_event_service import record_similarity_cue_delivery

SimilarityCueDeliveryStatus = Literal["suppressed", "delivered", "failed"]


@dataclass(frozen=True)
class SimilarityCueDeliverySummary:
    attempted: int
    delivered: int
    failed: int
    suppressed: int

    @classmethod
    def from_statuses(cls, statuses: list[SimilarityCueDeliveryStatus]) -> "SimilarityCueDeliverySummary":
        suppressed = statuses.count("suppressed")
        delivered = statuses.count("delivered")
        failed = statuses.count("failed")
        return cls(
            attempted=delivered + failed,
            delivered=delivered,
            failed=failed,
            suppressed=suppressed,
        )


async def notify_similarity_cue(similarity: Similarity) -> SimilarityCueDeliverySummary:
    idea_a = similarity.idea_block_1
    idea_b = similarity.idea_block_2
    return await notify_similarity_cue_for_blocks(
        similarity_id=similarity.id,
        is_same_reason=similarity.is_same_reason,
        reason=similarity.reason,
        idea_a=idea_a,
        idea_b=idea_b,
    )


async def notify_similarity_cue_for_blocks(
    *,
    similarity_id: int,
    is_same_reason: bool,
    idea_a: IdeaBlock,
    idea_b: IdeaBlock,
    reason: str = "",
) -> SimilarityCueDeliverySummary:
    if idea_a.session_name != idea_b.session_name:
        return SimilarityCueDeliverySummary(attempted=0, delivered=0, failed=0, suppressed=0)

    statuses = [
        await send_similarity_cue(
            session_name=idea_a.session_name,
            participant_id=str(idea_a.user_id),
            own_block=idea_a,
            other_block=idea_b,
            similarity_id=similarity_id,
            is_same_reason=is_same_reason,
            reason=reason,
        ),
        await send_similarity_cue(
            session_name=idea_b.session_name,
            participant_id=str(idea_b.user_id),
            own_block=idea_b,
            other_block=idea_a,
            similarity_id=similarity_id,
            is_same_reason=is_same_reason,
            reason=reason,
        ),
    ]
    return SimilarityCueDeliverySummary.from_statuses(statuses)


async def send_similarity_cue(
    *,
    session_name: str,
    participant_id: str,
    own_block: IdeaBlock,
    other_block: IdeaBlock,
    similarity_id: int,
    is_same_reason: bool,
    reason: str = "",
) -> SimilarityCueDeliveryStatus:
    if not is_similarity_cue_enabled(session_name):
        logger.info(
            "similarity_cue_suppressed session_name=%s participant_id=%s own_block_id=%s other_block_id=%s similarity_id=%s",
            session_name,
            participant_id,
            own_block.id,
            other_block.id,
            similarity_id,
        )
        return "suppressed"

    cue_id = f"similarity-{similarity_id}-{own_block.id}-{int(time.time() * 1000)}"
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
                "id": cue_id,
                "cueId": cue_id,
                "similarityId": similarity_id,
                "blockId": str(own_block.id),
                "ownBlockId": str(own_block.id),
                "otherBlockId": str(other_block.id),
                "blockSummary": other_block.title or other_block.summary,
                "isSameReason": is_same_reason,
            },
        },
    )
    async with SessionLocal() as db:
        try:
            await record_similarity_cue_delivery(
                db,
                cue_id=cue_id,
                session_name=session_name,
                phase=get_session_phase(session_name),
                condition=get_session_cue_condition(session_name),
                cue_enabled=is_similarity_cue_enabled(session_name),
                recipient_participant_id=participant_id,
                own_block=own_block,
                other_block=other_block,
                similarity_id=similarity_id,
                is_same_reason=is_same_reason,
                reason=reason,
                delivery_status="delivered" if cue_sent else "failed",
                event_metadata={
                    "update_sent": update_sent,
                    "board_participants": board_manager.get_participants(session_name),
                },
            )
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "similarity_cue_delivery_persist_failed session_name=%s participant_id=%s cue_id=%s similarity_id=%s error_type=%s error=%s",
                session_name,
                participant_id,
                cue_id,
                similarity_id,
                exc.__class__.__name__,
                exc,
            )
    logger.info(
        "similarity_cue_notify session_name=%s participant_id=%s own_block_id=%s other_block_id=%s similarity_id=%s is_same_reason=%s update_sent=%s cue_sent=%s board_participants=%s",
        session_name,
        participant_id,
        own_block.id,
        other_block.id,
        similarity_id,
        is_same_reason,
        update_sent,
        cue_sent,
        board_manager.get_participants(session_name),
    )
    return "delivered" if cue_sent else "failed"
