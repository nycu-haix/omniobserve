from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .ranking_phase_snapshot import RankingPhaseSnapshot


class RankingPhaseSnapshotItem(Base):
    __tablename__ = "ranking_phase_snapshot_items"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "position", name="uq_ranking_phase_snapshot_items_snapshot_position"),
        Index("idx_ranking_phase_snapshot_items_snapshot_position", "snapshot_id", "position"),
        Index("idx_ranking_phase_snapshot_items_item_id", "item_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ranking_phase_snapshots.id"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    snapshot: Mapped["RankingPhaseSnapshot"] = relationship(back_populates="items")
