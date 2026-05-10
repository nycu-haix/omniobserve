"""add similarity same reason flag

Revision ID: 20260510_0007
Revises: 20260510_0006
Create Date: 2026-05-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260510_0007"
down_revision: Union[str, None] = "20260510_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "similarities",
        sa.Column("is_same_reason", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("similarities", "is_same_reason")
