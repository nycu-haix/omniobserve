from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from .base import Base
from .visibility import Visibility

if TYPE_CHECKING:
    from .idea_block_to_transcript import IdeaBlockToTranscript
    from .poster_idea_block_task_item import PosterIdeaBlockTaskItem
    from .task_item import TaskItem
    from .transcript import Transcript


class IdeaBlock(Base):
    __tablename__ = "idea_blocks"
    __table_args__ = (
        Index("idx_idea_blocks_task_name", "task_name"),
        Index("idx_idea_blocks_session_task", "session_name", "task_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    session_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_name: Mapped[str] = mapped_column(String(64), nullable=False, server_default="lost-at-sea", default="lost-at-sea")
    time_stamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    title: Mapped[str] = mapped_column(String(20), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    transcript_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("transcript.id"),
        nullable=True,
    )
    embedding_vector: Mapped[list[float] | None] = mapped_column(Vector(1024), nullable=True)
    similarity_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false(), default=False, index=True)

    main_transcript: Mapped["Transcript | None"] = relationship(back_populates="idea_blocks")
    task_items: Mapped[list["TaskItem"]] = relationship(
        back_populates="idea_block",
        cascade="all, delete-orphan",
    )
    poster_task_items: Mapped[list["PosterIdeaBlockTaskItem"]] = relationship(
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
    def similarity_is_same_reason(self) -> bool | None:
        return getattr(self, "_similarity_is_same_reason", None)

    @property
    def is_duplicate(self) -> bool:
        return self.duplicate_of_id is not None

    @property
    def duplicate_of_id(self) -> int | None:
        return getattr(self, "_duplicate_of_id", None)

    @property
    def duplicate_reason(self) -> str | None:
        return getattr(self, "_duplicate_reason", None)

    @property
    def duplicate_similarity(self) -> float | None:
        return getattr(self, "_duplicate_similarity", None)

    @similarity_is_same_reason.setter
    def similarity_is_same_reason(self, value: bool | None) -> None:
        self._similarity_is_same_reason = value

    @property
    def created_at(self) -> datetime:
        return self.time_stamp

    @property
    def updated_at(self) -> datetime:
        return self.time_stamp
