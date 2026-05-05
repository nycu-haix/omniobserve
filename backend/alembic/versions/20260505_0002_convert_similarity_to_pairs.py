"""convert similarities to pair relationships

Revision ID: 20260505_0002
Revises: 20260502_0001
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260505_0002"
down_revision: Union[str, None] = "20260502_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("idx_idea_blocks_similarity_id", table_name="idea_blocks")
    op.drop_constraint("idea_blocks_similarity_id_fkey", "idea_blocks", type_="foreignkey")
    op.drop_column("idea_blocks", "similarity_id")
    op.add_column("idea_blocks", sa.Column("similarity_id", sa.BigInteger(), nullable=True))
    op.create_index("idx_idea_blocks_similarity_id", "idea_blocks", ["similarity_id"])

    op.drop_table("similarities")
    op.create_table(
        "similarities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("idea_block_id_1", sa.BigInteger(), sa.ForeignKey("idea_blocks.id"), nullable=False),
        sa.Column("idea_block_id_2", sa.BigInteger(), sa.ForeignKey("idea_blocks.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.CheckConstraint("idea_block_id_1 <> idea_block_id_2", name="ck_similarities_distinct_idea_blocks"),
    )
    op.create_index("idx_similarities_idea_block_id_1", "similarities", ["idea_block_id_1"])
    op.create_index("idx_similarities_idea_block_id_2", "similarities", ["idea_block_id_2"])
    op.execute(
        "CREATE UNIQUE INDEX uq_similarities_pair "
        "ON similarities (LEAST(idea_block_id_1, idea_block_id_2), GREATEST(idea_block_id_1, idea_block_id_2))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_similarities_pair")
    op.drop_index("idx_similarities_idea_block_id_2", table_name="similarities")
    op.drop_index("idx_similarities_idea_block_id_1", table_name="similarities")
    op.drop_table("similarities")

    op.drop_index("idx_idea_blocks_similarity_id", table_name="idea_blocks")
    op.drop_column("idea_blocks", "similarity_id")

    op.create_table(
        "similarities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("similarity_reason", sa.Text(), nullable=False),
    )
    op.add_column("idea_blocks", sa.Column("similarity_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("idea_blocks_similarity_id_fkey", "idea_blocks", "similarities", ["similarity_id"], ["id"])
    op.create_index("idx_idea_blocks_similarity_id", "idea_blocks", ["similarity_id"])
