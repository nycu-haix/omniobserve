from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PosterTaskItem(Base):
    __tablename__ = "poster_task_items"
    __table_args__ = (
        CheckConstraint(
            "action IN ('add', 'remove', 'edit')",
            name="ck_poster_task_items_action",
        ),
        Index("idx_poster_task_items_task_session", "task_name", "session_name"),
        Index("idx_poster_task_items_task_session_user", "task_name", "session_name", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    poster_component: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    advanced_action: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
