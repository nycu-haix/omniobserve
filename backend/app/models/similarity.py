import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .idea_block import IdeaBlock


class Similarity(Base):
    __tablename__ = "similarities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    similarity_reason: Mapped[str] = mapped_column(Text, nullable=False)

    idea_blocks: Mapped[list["IdeaBlock"]] = relationship(back_populates="similarity")
