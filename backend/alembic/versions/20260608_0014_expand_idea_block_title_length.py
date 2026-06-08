"""expand idea block title length

Revision ID: 20260608_0014
Revises: 20260608_0013
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa


revision = "20260608_0014"
down_revision = "20260608_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "idea_blocks",
        "title",
        existing_type=sa.String(length=10),
        type_=sa.String(length=20),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "idea_blocks",
        "title",
        existing_type=sa.String(length=20),
        type_=sa.String(length=10),
        existing_nullable=False,
    )
