"""add idea block soft delete flag

Revision ID: 20260505_0003
Revises: 20260505_0002
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260505_0003"
down_revision: Union[str, None] = "20260505_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "idea_blocks",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("idx_idea_blocks_is_deleted", "idea_blocks", ["is_deleted"])


def downgrade() -> None:
    op.drop_index("idx_idea_blocks_is_deleted", table_name="idea_blocks")
    op.drop_column("idea_blocks", "is_deleted")
