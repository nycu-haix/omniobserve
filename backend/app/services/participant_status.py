from typing import Any

from ..utils import to_iso_z, utc_now


_participant_statuses: dict[str, dict[str, dict[str, Any]]] = {}


def update_audio_status(
    session_name: str,
    participant_id: str,
    *,
    mic_mode: str,
    audio_connected: bool,
    is_speaking: bool = False,
    display_name: str | None = None,
    client_id: str | None = None,
) -> None:
    session_statuses = _participant_statuses.setdefault(session_name, {})
    current = session_statuses.get(participant_id, {})
    session_statuses[participant_id] = {
        **current,
        "id": participant_id,
        "mic_mode": mic_mode,
        "audio_connected": audio_connected,
        "is_speaking": is_speaking,
        "display_name": display_name if display_name is not None else current.get("display_name"),
        "client_id": client_id if client_id is not None else current.get("client_id"),
        "updated_at": to_iso_z(utc_now()),
    }


def mark_audio_disconnected(session_name: str, participant_id: str) -> None:
    update_audio_status(
        session_name,
        participant_id,
        mic_mode="off",
        audio_connected=False,
        is_speaking=False,
    )


def get_participant_presence(session_name: str, participant_ids: list[str]) -> list[dict[str, Any]]:
    session_statuses = _participant_statuses.get(session_name, {})
    participants: list[dict[str, Any]] = []
    for participant_id in sorted(set(participant_ids)):
        status = session_statuses.get(participant_id, {})
        participants.append(
            {
                "id": participant_id,
                "mic_mode": status.get("mic_mode", "off"),
                "audio_connected": bool(status.get("audio_connected", False)),
                "is_speaking": bool(status.get("is_speaking", False)),
                "display_name": status.get("display_name"),
                "client_id": status.get("client_id"),
                "updated_at": status.get("updated_at"),
            }
        )
    return participants


def get_participant_display_name(session_name: str, participant_id: str) -> str | None:
    status = _participant_statuses.get(session_name, {}).get(participant_id, {})
    display_name = status.get("display_name")
    return display_name if isinstance(display_name, str) and display_name.strip() else None
