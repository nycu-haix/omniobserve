from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SimilarityCueEvent(Base):
    __tablename__ = "similarity_cue_events"
    __table_args__ = (
        UniqueConstraint("session_name", "cue_id", name="uq_similarity_cue_events_session_cue_id"),
        Index("idx_similarity_cue_events_session_task", "session_name", "task_id"),
        Index("idx_similarity_cue_events_session_recipient", "session_name", "recipient_participant_id"),
        Index("idx_similarity_cue_events_similarity", "similarity_id"),
        Index("idx_similarity_cue_events_own_block", "own_idea_block_id"),
        Index("idx_similarity_cue_events_other_block", "other_idea_block_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    cue_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, default="similarity_cue", server_default="similarity_cue", index=True)
    source: Mapped[str] = mapped_column(String(80), nullable=False, default="similarity_pair", server_default="similarity_pair")
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    group_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    condition: Mapped[str] = mapped_column(String(32), nullable=False, default="experimental", server_default="experimental", index=True)
    cue_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)
    phase: Mapped[str] = mapped_column(String(80), nullable=False, default="unknown", server_default="unknown", index=True)
    cue_type: Mapped[str] = mapped_column(String(80), nullable=False, default="same_reason", server_default="same_reason", index=True)
    sender_participant_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    recipient_participant_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    similarity_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("similarities.id", ondelete="SET NULL"), nullable=True, index=True)
    own_idea_block_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("idea_blocks.id", ondelete="SET NULL"), nullable=True, index=True)
    other_idea_block_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("idea_blocks.id", ondelete="SET NULL"), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", server_default="pending", index=True)
    response_status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ignored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    event_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
