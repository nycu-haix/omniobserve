from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now_model() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class MicMode(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


class FileFormat(str, Enum):
    WAV = "wav"
    WEBM = "webm"
    MP3 = "mp3"
    M4A = "m4a"


class Visibility(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"


class AudioSegment(Base):
    __tablename__ = "audio_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    participant_id: Mapped[str] = mapped_column(String(255), index=True)
    mic_mode: Mapped[MicMode] = mapped_column(SAEnum(MicMode, name="mic_mode_enum"))
    file_format: Mapped[FileFormat] = mapped_column(SAEnum(FileFormat, name="file_format_enum"))
    duration_ms: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    retry_of: Mapped[str | None] = mapped_column(String(36), nullable=True)
    storage_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: utc_now_model())

    transcripts: Mapped[list["TranscriptSegment"]] = relationship(back_populates="source_audio")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    participant_id: Mapped[str] = mapped_column(String(255), index=True)
    visibility: Mapped[Visibility] = mapped_column(SAEnum(Visibility, name="visibility_enum"))
    text: Mapped[str] = mapped_column(Text)
    source_audio_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audio_segments.id"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: utc_now_model())

    source_audio: Mapped[AudioSegment | None] = relationship(back_populates="transcripts")


class IdeaBlock(Base):
    __tablename__ = "idea_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    participant_id: Mapped[str] = mapped_column(String(255), index=True)
    visibility: Mapped[Visibility] = mapped_column(SAEnum(Visibility, name="idea_visibility_enum"))
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_transcript_ids: Mapped[list[str]] = mapped_column(ARRAY(String(36)), default=list)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(255)), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: utc_now_model())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: utc_now_model())

    bullet_points: Mapped[list["BulletPoint"]] = relationship(
        back_populates="idea_block", cascade="all, delete-orphan", order_by="BulletPoint.order_index"
    )


class BulletPoint(Base):
    __tablename__ = "bullet_points"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    idea_block_id: Mapped[str] = mapped_column(String(36), ForeignKey("idea_blocks.id"), index=True)
    session_id: Mapped[str] = mapped_column(String(255), index=True)
    participant_id: Mapped[str] = mapped_column(String(255), index=True)
    visibility: Mapped[Visibility] = mapped_column(SAEnum(Visibility, name="bullet_visibility_enum"))
    text: Mapped[str] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: utc_now_model())

    idea_block: Mapped[IdeaBlock] = relationship(back_populates="bullet_points")
