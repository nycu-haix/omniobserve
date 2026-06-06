"""add transcript display name

Revision ID: 20260602_0008
Revises: 20260510_0007
Create Date: 2026-06-02
"""

from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260602_0008"
down_revision: Union[str, None] = "20260510_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("transcript", sa.Column("display_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("transcript", "display_name")
