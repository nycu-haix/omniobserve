from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TranscriptGenerationDecision(Base):
    __tablename__ = "transcript_generation_decisions"
    __table_args__ = (
        UniqueConstraint("pipeline_run_id", name="uq_transcript_generation_decisions_pipeline_run_id"),
        Index("idx_transcript_generation_decisions_session_task", "session_name", "task_name"),
        Index("idx_transcript_generation_decisions_transcript", "transcript_id"),
        Index("idx_transcript_generation_decisions_created_at", "created_at"),
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
    client_segment_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    segment_cut_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    transcript_saved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_done_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    cut_to_decision_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    save_to_decision_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decision: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    generated_idea_block_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    duplicate_idea_block_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    transcript_chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    session_transcript_count_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_idea_block_count_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    participant_idea_block_count_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    skipped_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    event_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
