"""create ranking moves

Revision ID: 20260510_0006
Revises: 20260509_0005
Create Date: 2026-05-10
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260510_0006"
down_revision: Union[str, None] = "20260509_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ranking_moves",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_name", sa.String(length=255), nullable=False),
        sa.Column("participant_id", sa.String(length=255), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.String(length=255), nullable=False),
        sa.Column("from_index", sa.Integer(), nullable=True),
        sa.Column("to_index", sa.Integer(), nullable=False),
        sa.Column("base_revision", sa.Integer(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("previous_items", sa.JSON(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("time_stamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_ranking_moves_session_name", "ranking_moves", ["session_name"])
    op.create_index("idx_ranking_moves_participant_id", "ranking_moves", ["participant_id"])
    op.create_index("idx_ranking_moves_scope", "ranking_moves", ["scope"])
    op.create_index("idx_ranking_moves_time_stamp", "ranking_moves", ["time_stamp"])


def downgrade() -> None:
    op.drop_index("idx_ranking_moves_time_stamp", table_name="ranking_moves")
    op.drop_index("idx_ranking_moves_scope", table_name="ranking_moves")
    op.drop_index("idx_ranking_moves_participant_id", table_name="ranking_moves")
    op.drop_index("idx_ranking_moves_session_name", table_name="ranking_moves")
    op.drop_table("ranking_moves")
