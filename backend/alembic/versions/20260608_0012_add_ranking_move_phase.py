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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("ranking_moves")}
    indexes = {index["name"] for index in inspector.get_indexes("ranking_moves")}

    if "phase" not in columns:
        op.add_column(
            "ranking_moves",
            sa.Column("phase", sa.String(length=80), nullable=False, server_default="unknown"),
        )
    if "move_type" not in columns:
        op.add_column(
            "ranking_moves",
            sa.Column("move_type", sa.String(length=32), nullable=False, server_default="move"),
        )
    if "idx_ranking_moves_session_scope_phase" not in indexes:
        op.create_index("idx_ranking_moves_session_scope_phase", "ranking_moves", ["session_name", "scope", "phase"])
    if "ix_ranking_moves_phase" not in indexes:
        op.create_index("ix_ranking_moves_phase", "ranking_moves", ["phase"])
    if "ix_ranking_moves_move_type" not in indexes:
        op.create_index("ix_ranking_moves_move_type", "ranking_moves", ["move_type"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("ranking_moves")}
    indexes = {index["name"] for index in inspector.get_indexes("ranking_moves")}

    if "ix_ranking_moves_move_type" in indexes:
        op.drop_index("ix_ranking_moves_move_type", table_name="ranking_moves")
    if "ix_ranking_moves_phase" in indexes:
        op.drop_index("ix_ranking_moves_phase", table_name="ranking_moves")
    if "idx_ranking_moves_session_scope_phase" in indexes:
        op.drop_index("idx_ranking_moves_session_scope_phase", table_name="ranking_moves")
    if "move_type" in columns:
        op.drop_column("ranking_moves", "move_type")
    if "phase" in columns:
        op.drop_column("ranking_moves", "phase")

