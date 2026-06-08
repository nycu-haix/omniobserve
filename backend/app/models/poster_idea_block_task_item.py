from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .idea_block import IdeaBlock


class PosterIdeaBlockTaskItem(Base):
    __tablename__ = "poster_idea_block_task_items"
    __table_args__ = (
        UniqueConstraint(
            "idea_block_id",
            "component_id",
            "action_id",
            name="uq_poster_idea_block_task_items_block_component_action",
        ),
        Index("idx_poster_idea_block_task_items_component", "component_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    idea_block_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("idea_blocks.id"),
        nullable=False,
        index=True,
    )
    component_id: Mapped[str] = mapped_column(String(80), nullable=False)
    action_id: Mapped[str] = mapped_column(String(80), nullable=False)

    idea_block: Mapped["IdeaBlock"] = relationship(back_populates="poster_task_items")
