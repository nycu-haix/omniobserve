"""add transcript visibility

Revision ID: 20260507_0004
Revises: 20260505_0003
Create Date: 2026-05-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260507_0004"
down_revision: Union[str, None] = "20260505_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "transcript",
        sa.Column("visibility", sa.String(length=16), nullable=False, server_default="public"),
    )
    op.alter_column("transcript", "visibility", server_default="private")
    op.create_index("idx_transcript_visibility", "transcript", ["visibility"])


def downgrade() -> None:
    op.drop_index("idx_transcript_visibility", table_name="transcript")
    op.drop_column("transcript", "visibility")
