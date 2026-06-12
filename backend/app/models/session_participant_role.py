from datetime import datetime

from sqlalchemy import DateTime, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SessionParticipantRole(Base):
    __tablename__ = "session_participant_roles"
    __table_args__ = (
        UniqueConstraint("session_name", "participant_id", name="uq_session_participant_roles_session_participant"),
        Index("idx_session_participant_roles_session_role", "session_name", "participant_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    participant_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    participant_role: Mapped[str] = mapped_column(String(32), nullable=False, default="participant", server_default="participant", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
