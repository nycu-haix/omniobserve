from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .phase_task_item_snapshot import PhaseTaskItemSnapshot
    from .private_phase_task_item import PrivatePhaseTaskItem


class PhaseTaskItemSnapshotItem(Base):
    __tablename__ = "phase_task_item_snapshot_items"
    __table_args__ = (
        UniqueConstraint(
            "snapshot_id",
            "component_id",
            "action_id",
            "statement",
            name="uq_phase_task_item_snapshot_items_dedupe_key",
        ),
        Index("idx_phase_task_item_snapshot_items_snapshot_position", "snapshot_id", "position"),
        Index("idx_phase_task_item_snapshot_items_component", "component_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("phase_task_item_snapshots.id"),
        nullable=False,
        index=True,
    )
    representative_private_phase_task_item_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("private_phase_task_items.id"),
        nullable=True,
        index=True,
    )
    component_id: Mapped[str] = mapped_column(String(80), nullable=False)
    component_label: Mapped[str] = mapped_column(String(120), nullable=False)
    action_id: Mapped[str] = mapped_column(String(80), nullable=False)
    action_label: Mapped[str] = mapped_column(String(120), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    source_user_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    source_priorities: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    position: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    snapshot: Mapped["PhaseTaskItemSnapshot"] = relationship(back_populates="items")
    representative_private_phase_task_item: Mapped["PrivatePhaseTaskItem | None"] = relationship()
