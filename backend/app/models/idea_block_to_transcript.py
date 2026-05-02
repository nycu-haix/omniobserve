from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .idea_block import IdeaBlock
    from .transcript import Transcript


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

    idea_block: Mapped["IdeaBlock"] = relationship(back_populates="transcript_links")
    transcript: Mapped["Transcript"] = relationship(back_populates="idea_block_links")
