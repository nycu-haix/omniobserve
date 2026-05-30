from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .idea_block import IdeaBlock


class PosterIdeaBlockTaskItem(Base):
    __tablename__ = "poster_idea_block_task_items"
    __table_args__ = (
        CheckConstraint(
            "action IN ('add', 'remove', 'edit')",
            name="ck_poster_idea_block_task_items_action",
        ),
        Index(
            "idx_poster_idea_block_task_items_triple",
            "poster_component",
            "action",
            "advanced_action",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    idea_block_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("idea_blocks.id"),
        nullable=False,
        index=True,
    )
    poster_component: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    advanced_action: Mapped[str] = mapped_column(String(64), nullable=False)

    idea_block: Mapped["IdeaBlock"] = relationship(back_populates="poster_task_items")
