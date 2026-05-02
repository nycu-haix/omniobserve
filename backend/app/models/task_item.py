from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .idea_block import IdeaBlock


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

    idea_block: Mapped["IdeaBlock"] = relationship(back_populates="task_items")
