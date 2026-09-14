from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .ranking_phase_snapshot_item import RankingPhaseSnapshotItem


class RankingPhaseSnapshot(Base):
    __tablename__ = "ranking_phase_snapshots"
    __table_args__ = (
        Index("idx_ranking_phase_snapshots_session_task_phase", "session_name", "task_id", "phase"),
        Index("idx_ranking_phase_snapshots_session_scope_subject", "session_name", "scope", "subject_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    condition: Mapped[str] = mapped_column(String(32), nullable=False, default="experimental", server_default="experimental", index=True)
    cue_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)
    phase: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    subject_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    participant_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    group_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(80), nullable=False, default="phase_boundary", server_default="phase_boundary", index=True)
    source_phase: Mapped[str | None] = mapped_column(String(80), nullable=True)
    next_phase: Mapped[str | None] = mapped_column(String(80), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    change_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ranking_move_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    items: Mapped[list["RankingPhaseSnapshotItem"]] = relationship(
        back_populates="snapshot",
        cascade="all, delete-orphan",
        order_by="RankingPhaseSnapshotItem.position",
    )
