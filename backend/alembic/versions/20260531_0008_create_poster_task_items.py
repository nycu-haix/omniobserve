"""create poster task items

Revision ID: 20260531_0008
Revises: 20260510_0007
Create Date: 2026-05-31
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260531_0008"
down_revision: Union[str, None] = "20260510_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "poster_task_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("task_name", sa.String(length=64), nullable=False),
        sa.Column("session_name", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("poster_component", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("advanced_action", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("action IN ('add', 'remove', 'edit')", name="ck_poster_task_items_action"),
    )
    op.create_index("ix_poster_task_items_task_name", "poster_task_items", ["task_name"])
    op.create_index("ix_poster_task_items_session_name", "poster_task_items", ["session_name"])
    op.create_index("ix_poster_task_items_user_id", "poster_task_items", ["user_id"])
    op.create_index("idx_poster_task_items_task_session", "poster_task_items", ["task_name", "session_name"])
    op.create_index(
        "idx_poster_task_items_task_session_user",
        "poster_task_items",
        ["task_name", "session_name", "user_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_poster_task_items_task_session_user", table_name="poster_task_items")
    op.drop_index("idx_poster_task_items_task_session", table_name="poster_task_items")
    op.drop_index("ix_poster_task_items_user_id", table_name="poster_task_items")
    op.drop_index("ix_poster_task_items_session_name", table_name="poster_task_items")
    op.drop_index("ix_poster_task_items_task_name", table_name="poster_task_items")
    op.drop_table("poster_task_items")
