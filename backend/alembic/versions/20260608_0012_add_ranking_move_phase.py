"""add ranking move phase metadata

Revision ID: 20260608_0012
Revises: 20260607_0011
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa


revision = "20260608_0012"
down_revision = "20260607_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ranking_moves",
        sa.Column("phase", sa.String(length=80), nullable=False, server_default="unknown"),
    )
    op.add_column(
        "ranking_moves",
        sa.Column("move_type", sa.String(length=32), nullable=False, server_default="move"),
    )
    op.create_index("idx_ranking_moves_session_scope_phase", "ranking_moves", ["session_name", "scope", "phase"])
    op.create_index("ix_ranking_moves_phase", "ranking_moves", ["phase"])
    op.create_index("ix_ranking_moves_move_type", "ranking_moves", ["move_type"])


def downgrade() -> None:
    op.drop_index("ix_ranking_moves_move_type", table_name="ranking_moves")
    op.drop_index("ix_ranking_moves_phase", table_name="ranking_moves")
    op.drop_index("idx_ranking_moves_session_scope_phase", table_name="ranking_moves")
    op.drop_column("ranking_moves", "move_type")
    op.drop_column("ranking_moves", "phase")

