from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import SessionParticipantRole
from ..schemas import ApiError

PARTICIPANT_ROLE = "participant"
OBSERVER_ROLE = "observer"
VALID_PARTICIPANT_ROLES = {PARTICIPANT_ROLE, OBSERVER_ROLE}


def normalize_participant_role(value: Any) -> str:
    role = str(value or PARTICIPANT_ROLE).strip().lower().replace("_", "-")
    if role in {"nonparticipant", "non-participant", "facilitator"}:
        return OBSERVER_ROLE
    if role not in VALID_PARTICIPANT_ROLES:
        raise ApiError(
            400,
            "INVALID_PARTICIPANT_ROLE",
            "participant role must be participant or observer",
            details={"role": value},
        )
    return role


def is_observer_role(value: Any) -> bool:
    try:
        return normalize_participant_role(value) == OBSERVER_ROLE
    except ApiError:
        return False


async def list_session_participant_roles(db: AsyncSession, *, session_name: str) -> dict[str, str]:
    result = await db.execute(
        select(SessionParticipantRole).where(SessionParticipantRole.session_name == session_name)
    )
    return {
        row.participant_id: normalize_participant_role(row.participant_role)
        for row in result.scalars().all()
    }


async def set_session_participant_role(
    db: AsyncSession,
    *,
    session_name: str,
    participant_id: str,
    participant_role: str,
) -> SessionParticipantRole:
    normalized_session_name = str(session_name).strip()
    if not normalized_session_name:
        raise ApiError(
            400,
            "SESSION_NAME_REQUIRED",
            "session_name is required",
            details={"field": "session_name"},
        )
    normalized_participant_id = str(participant_id).strip()
    if not normalized_participant_id:
        raise ApiError(
            400,
            "PARTICIPANT_ID_REQUIRED",
            "participant_id is required",
            details={"field": "participant_id"},
        )
    normalized_role = normalize_participant_role(participant_role)
    result = await db.execute(
        select(SessionParticipantRole).where(
            SessionParticipantRole.session_name == normalized_session_name,
            SessionParticipantRole.participant_id == normalized_participant_id,
        )
    )
    role = result.scalar_one_or_none()
    if role is None:
        role = SessionParticipantRole(
            session_name=normalized_session_name,
            participant_id=normalized_participant_id,
            participant_role=normalized_role,
        )
        db.add(role)
    else:
        role.participant_role = normalized_role
    await db.flush()
    return role
