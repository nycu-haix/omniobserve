from datetime import datetime

from sqlalchemy import DateTime, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RankingMove(Base):
    __tablename__ = "ranking_moves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    participant_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(255), nullable=False)
    from_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    to_index: Mapped[int] = mapped_column(Integer, nullable=False)
    base_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_items: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    items: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    time_stamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
