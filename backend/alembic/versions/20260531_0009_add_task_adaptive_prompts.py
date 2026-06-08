"""add task adaptive prompt storage

Revision ID: 20260531_0009
Revises: 20260531_0008
Create Date: 2026-05-31
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260531_0009"
down_revision: Union[str, None] = "20260531_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "idea_blocks",
        sa.Column("task_name", sa.String(length=64), nullable=False, server_default="lost-at-sea"),
    )
    op.create_index("idx_idea_blocks_task_name", "idea_blocks", ["task_name"])
    op.create_index("idx_idea_blocks_session_task", "idea_blocks", ["session_name", "task_name"])

    op.create_table(
        "poster_idea_block_task_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("idea_block_id", sa.BigInteger(), sa.ForeignKey("idea_blocks.id"), nullable=False),
        sa.Column("poster_component", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("advanced_action", sa.String(length=64), nullable=False),
        sa.CheckConstraint("action IN ('add', 'remove', 'edit')", name="ck_poster_idea_block_task_items_action"),
    )
    op.create_index(
        "ix_poster_idea_block_task_items_idea_block_id",
        "poster_idea_block_task_items",
        ["idea_block_id"],
    )
    op.create_index(
        "idx_poster_idea_block_task_items_triple",
        "poster_idea_block_task_items",
        ["poster_component", "action", "advanced_action"],
    )


def downgrade() -> None:
    op.drop_index("idx_poster_idea_block_task_items_triple", table_name="poster_idea_block_task_items")
    op.drop_index("ix_poster_idea_block_task_items_idea_block_id", table_name="poster_idea_block_task_items")
    op.drop_table("poster_idea_block_task_items")
    op.drop_index("idx_idea_blocks_session_task", table_name="idea_blocks")
    op.drop_index("idx_idea_blocks_task_name", table_name="idea_blocks")
    op.drop_column("idea_blocks", "task_name")
