import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


class Visibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


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


class Similarity(Base):
    __tablename__ = "similarities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    similarity_reason: Mapped[str] = mapped_column(Text, nullable=False)

    idea_blocks: Mapped[list["IdeaBlock"]] = relationship(back_populates="similarity")


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

    main_transcript: Mapped[Transcript | None] = relationship(back_populates="idea_blocks")
    similarity: Mapped[Similarity | None] = relationship(back_populates="idea_blocks")
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
        return None

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


class TaskItem(Base):
    __tablename__ = "task_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    idea_block_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("idea_blocks.id"),
        nullable=False,
        index=True,
    )
    task_item_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)

    idea_block: Mapped[IdeaBlock] = relationship(back_populates="task_items")


class IdeaBlockToTranscript(Base):
    __tablename__ = "idea_block_to_transcript"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    idea_blocks_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("idea_blocks.id"),
        nullable=False,
        index=True,
    )
    transcript_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("transcript.id"),
        nullable=False,
        index=True,
    )

    idea_block: Mapped[IdeaBlock] = relationship(back_populates="transcript_links")
    transcript: Mapped[Transcript] = relationship(back_populates="idea_block_links")
