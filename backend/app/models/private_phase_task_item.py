from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PrivatePhaseTaskItem(Base):
    __tablename__ = "private_phase_task_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    component_id: Mapped[str] = mapped_column(String(80), nullable=False)
    component_label: Mapped[str] = mapped_column(String(120), nullable=False)
    action_id: Mapped[str] = mapped_column(String(80), nullable=False)
    action_label: Mapped[str] = mapped_column(String(120), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
