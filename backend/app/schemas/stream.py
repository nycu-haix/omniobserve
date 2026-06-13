from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..models import Visibility


@dataclass
class StreamContext:
    scope: Visibility
    sample_rate: int
    client_id: str | None
    source: str | None
    agent_type: str | None
    encoding: str | None
    channels: int
    start_message: dict[str, Any]


@dataclass
class StreamTranscript:
    segment_id: str
    text: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
