"""Recoverable cue candidates. Scheduling belongs to the participant's UI."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import SimilarityCueEvent
from .similarity_service import list_scoped_similarities
from .similarity_cue_event_service import record_similarity_cue_response, _resolve_group_id
from ..task_config import resolve_task_id
from ..utils import utc_now

TERMINAL_RESPONSES = {"accepted", "dismissed", "ignored", "shared"}


def pair_cue_id(own_id: int, other_id: int) -> str:
    # Pair row IDs change when detection reruns; block identity does not.
    return f"pair-{own_id}-{other_id}"


def response_for_pair(events, own_id: int, other_id: int) -> str | None:
    matching = [event for event in events if event.own_idea_block_id == own_id
                and event.other_idea_block_id == other_id
                and event.event_type in {"similarity_cue", "cue_response"}]
    terminal = next((event.response_status for event in reversed(matching)
                     if event.response_status in TERMINAL_RESPONSES), None)
    return terminal or ("shown" if any(event.shown_at for event in matching) else None)


async def list_cue_queue(db: AsyncSession, *, session_name: str, user_id: int) -> dict:
    from .realtime import session_public_context_state
    from .public_context_matching import find_public_context_component_matches, find_public_context_task_item_matches

    pairs = await list_scoped_similarities(db=db, session_name=session_name, user_id=user_id)
    events = (await db.execute(select(SimilarityCueEvent).where(
        SimilarityCueEvent.session_name == session_name,
        SimilarityCueEvent.recipient_participant_id == str(user_id),
    ).order_by(SimilarityCueEvent.id.asc()))).scalars().all()
    cues = []
    seen = set()
    for pair in pairs:
        own, other = pair.idea_block_1, pair.idea_block_2
        if own.user_id != user_id:
            own, other = other, own
        if own.user_id == other.user_id:
            continue
        cue_id = pair_cue_id(own.id, other.id)
        if cue_id in seen:
            continue
        seen.add(cue_id)
        cues.append({
            "id": cue_id, "cueId": cue_id, "similarityId": pair.id,
            "blockId": str(own.id), "ownBlockId": str(own.id), "otherBlockId": str(other.id),
            "blockSummary": own.title or own.summary,
            "isSameReason": pair.is_same_reason,
            "responseStatus": response_for_pair(events, own.id, other.id),
        })
    # Reuse the current Now targets; do not run transcript inference again.
    context = session_public_context_state.get(session_name) or {}
    matches = []
    if context.get("component_ids"):
        matches += await find_public_context_component_matches(db, session_name=session_name, component_ids=context["component_ids"])
    if context.get("task_item_ids"):
        matches += await find_public_context_task_item_matches(db, session_name=session_name, task_item_ids=context["task_item_ids"])
    return {"cues": cues, "nowBlockIds": sorted({str(match.idea_block_id) for match in matches if match.user_id == user_id})}


async def save_cue_response(db: AsyncSession, *, session_name: str, user_id: int, cue_id: str, response: str) -> dict:
    from .realtime import get_session_phase, get_session_cue_condition, is_similarity_cue_enabled

    pairs = await list_scoped_similarities(db=db, session_name=session_name, user_id=user_id)
    for pair in pairs:
        own, other = pair.idea_block_1, pair.idea_block_2
        if own.user_id != user_id:
            own, other = other, own
        if own.user_id != other.user_id and pair_cue_id(own.id, other.id) == cue_id:
            break
    else:
        raise HTTPException(status_code=404, detail="Cue not found for this participant")
    if not is_similarity_cue_enabled(session_name):
        raise HTTPException(status_code=409, detail="Similarity cues are disabled in this phase or condition")
    context = dict(phase=get_session_phase(session_name), condition=get_session_cue_condition(session_name), cue_enabled=True)
    # Serialize writes to this pair, including retries and a late shown response.
    from sqlalchemy import text
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"{session_name}:{cue_id}"})
    existing = (await db.execute(select(SimilarityCueEvent).where(
        SimilarityCueEvent.session_name == session_name, SimilarityCueEvent.cue_id == cue_id,
    ))).scalar_one_or_none()
    if existing is not None and existing.response_status in TERMINAL_RESPONSES:
        return {"cueId": cue_id, "responseStatus": existing.response_status}
    if existing is None:
        db.add(SimilarityCueEvent(cue_id=cue_id, event_type="similarity_cue", source="similarity_pair",
            session_name=session_name, task_id=resolve_task_id(session_name=session_name),
            group_id=_resolve_group_id(session_name=session_name), recipient_participant_id=str(user_id),
            own_idea_block_id=own.id, other_idea_block_id=other.id, similarity_id=pair.id,
            cue_type="same_reason" if pair.is_same_reason else "different_reason",
            reason=pair.reason, delivery_status="delivered", delivered_at=utc_now(), **context))
        await db.flush()
    event = await record_similarity_cue_response(db, session_name=session_name, participant_id=str(user_id),
        cue_id=cue_id, response_status=response, block_id=own.id, **context)
    return {"cueId": cue_id, "responseStatus": event.response_status}
