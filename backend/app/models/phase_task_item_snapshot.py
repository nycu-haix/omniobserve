from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .phase_task_item_snapshot_item import PhaseTaskItemSnapshotItem


class PhaseTaskItemSnapshot(Base):
    __tablename__ = "phase_task_item_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "session_name",
            "task_id",
            "to_phase",
            name="uq_phase_task_item_snapshots_session_task_phase",
        ),
        Index("idx_phase_task_item_snapshots_session_task", "session_name", "task_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    from_phase: Mapped[str] = mapped_column(String(80), nullable=False)
    to_phase: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    shuffle_seed: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    items: Mapped[list["PhaseTaskItemSnapshotItem"]] = relationship(
        back_populates="snapshot",
        cascade="all, delete-orphan",
        order_by="PhaseTaskItemSnapshotItem.position",
    )
