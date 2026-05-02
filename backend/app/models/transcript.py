from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .idea_block import IdeaBlock
    from .idea_block_to_transcript import IdeaBlockToTranscript


class Transcript(Base):
    __tablename__ = "transcript"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    time_stamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    transcript: Mapped[str] = mapped_column(Text, nullable=False)

    idea_blocks: Mapped[list["IdeaBlock"]] = relationship(back_populates="main_transcript")
    idea_block_links: Mapped[list["IdeaBlockToTranscript"]] = relationship(
        back_populates="transcript",
        cascade="all, delete-orphan",
    )
