import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from .base import Base
from .visibility import Visibility

if TYPE_CHECKING:
    from .idea_block_to_transcript import IdeaBlockToTranscript
    from .similarity import Similarity
    from .task_item import TaskItem
    from .transcript import Transcript


class IdeaBlock(Base):
    __tablename__ = "idea_blocks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    time_stamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    title: Mapped[str] = mapped_column(String(10), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    transcript_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("transcript.id"),
        nullable=True,
    )
    embedding_vector: Mapped[list[float] | None] = mapped_column(Vector(1024), nullable=True)
    similarity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("similarities.id"),
        nullable=True,
        index=True,
    )

    main_transcript: Mapped["Transcript | None"] = relationship(back_populates="idea_blocks")
    similarity: Mapped["Similarity | None"] = relationship(back_populates="idea_blocks")
    task_items: Mapped[list["TaskItem"]] = relationship(
        back_populates="idea_block",
        cascade="all, delete-orphan",
    )
    transcript_links: Mapped[list["IdeaBlockToTranscript"]] = relationship(
        back_populates="idea_block",
        cascade="all, delete-orphan",
    )

    @property
    def session_id(self) -> str:
        return self.session_name

    @property
    def participant_id(self) -> str:
        return str(self.user_id)

    @property
    def visibility(self) -> Visibility:
        return Visibility.PRIVATE

    @property
    def content(self) -> str:
        return self.summary

    @content.setter
    def content(self, value: str) -> None:
        self.summary = value

    @property
    def transcript(self) -> str | None:
        if "main_transcript" not in self.__dict__ or self.main_transcript is None:
            return None
        return self.main_transcript.transcript

    @transcript.setter
    def transcript(self, _: str | None) -> None:
        return

    @property
    def source_transcript_ids(self) -> list[str]:
        return [str(self.transcript_id)] if self.transcript_id is not None else []

    @source_transcript_ids.setter
    def source_transcript_ids(self, _: list[str]) -> None:
        return

    @property
    def created_at(self) -> datetime:
        return self.time_stamp

    @property
    def updated_at(self) -> datetime:
        return self.time_stamp
