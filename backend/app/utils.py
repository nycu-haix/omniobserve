from datetime import datetime, timezone

from .schemas import ApiError


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso8601_utc(value: str, field_name: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ApiError(400, "INVALID_PAYLOAD", f"{field_name} must be a valid ISO 8601 timestamp") from exc

    if dt.tzinfo is None:
        raise ApiError(400, "INVALID_PAYLOAD", f"{field_name} must include timezone information")

    return dt.astimezone(timezone.utc)
