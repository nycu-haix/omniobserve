from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import SessionParticipantRole
from ..schemas import ApiError

PARTICIPANT_ROLE = "participant"
CONFEDERATE_ROLE = "confederate"
OBSERVER_ROLE = "observer"
FACILITATOR_ROLE = "facilitator"
TEST_ROLE = "test"
VALID_PARTICIPANT_ROLES = {
    PARTICIPANT_ROLE,
    CONFEDERATE_ROLE,
    OBSERVER_ROLE,
    FACILITATOR_ROLE,
    TEST_ROLE,
}
NON_ANALYSIS_PARTICIPANT_ROLES = {
    CONFEDERATE_ROLE,
    OBSERVER_ROLE,
    FACILITATOR_ROLE,
    TEST_ROLE,
}
AUDIO_TRANSCRIPTION_ROLES = {
    PARTICIPANT_ROLE,
    CONFEDERATE_ROLE,
}
PARTICIPANT_ROLE_ALIASES = {
    "nonparticipant": OBSERVER_ROLE,
    "non-participant": OBSERVER_ROLE,
    "staff": FACILITATOR_ROLE,
    "moderator": FACILITATOR_ROLE,
    "experimenter": FACILITATOR_ROLE,
    "confederate-script": CONFEDERATE_ROLE,
    "manipulation": CONFEDERATE_ROLE,
    "mock": TEST_ROLE,
    "mock-participant": TEST_ROLE,
    "test-client": TEST_ROLE,
}


def normalize_participant_role(value: Any) -> str:
    role = str(value or PARTICIPANT_ROLE).strip().lower().replace("_", "-")
    role = PARTICIPANT_ROLE_ALIASES.get(role, role)
    if role not in VALID_PARTICIPANT_ROLES:
        raise ApiError(
            400,
            "INVALID_PARTICIPANT_ROLE",
            "participant role must be participant, confederate, observer, facilitator, or test",
            details={"role": value},
        )
    return role


def is_observer_role(value: Any) -> bool:
    try:
        return normalize_participant_role(value) == OBSERVER_ROLE
    except ApiError:
        return False


def is_participant_analysis_role(value: Any) -> bool:
    try:
        return normalize_participant_role(value) == PARTICIPANT_ROLE
    except ApiError:
        return False


def is_non_analysis_participant_role(value: Any) -> bool:
    try:
        return normalize_participant_role(value) in NON_ANALYSIS_PARTICIPANT_ROLES
    except ApiError:
        return False


def is_audio_transcription_role(value: Any) -> bool:
    try:
        return normalize_participant_role(value) in AUDIO_TRANSCRIPTION_ROLES
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
