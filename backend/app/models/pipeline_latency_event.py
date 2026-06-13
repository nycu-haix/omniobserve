from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PipelineLatencyEvent(Base):
    __tablename__ = "pipeline_latency_events"
    __table_args__ = (
        Index("idx_pipeline_latency_events_pipeline_stage", "pipeline_run_id", "stage"),
        Index("idx_pipeline_latency_events_session_task", "session_name", "task_name"),
        Index("idx_pipeline_latency_events_transcript", "transcript_id"),
        Index("idx_pipeline_latency_events_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pipeline_run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    condition: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown", server_default="unknown", index=True)
    phase: Mapped[str] = mapped_column(String(80), nullable=False, default="unknown", server_default="unknown", index=True)
    participant_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    transcript_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    stage: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    meeting_elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    phase_elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transcript_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    session_transcript_count_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_idea_block_count_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    participant_idea_block_count_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    candidate_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    llm_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    event_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
