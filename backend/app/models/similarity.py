from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Similarity(Base):
    __tablename__ = "similarities"
    __table_args__ = (
        CheckConstraint("idea_block_id_1 <> idea_block_id_2", name="ck_similarities_distinct_idea_blocks"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    idea_block_id_1: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("idea_blocks.id"),
        nullable=False,
        index=True,
    )
    idea_block_id_2: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("idea_blocks.id"),
        nullable=False,
        index=True,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
