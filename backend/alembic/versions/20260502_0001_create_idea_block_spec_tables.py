"""create idea block spec tables

Revision ID: 20260502_0001
Revises:
Create Date: 2026-05-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "20260502_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "transcript",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("time_stamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("transcript", sa.Text(), nullable=False),
    )

    op.create_table(
        "similarities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("similarity_reason", sa.Text(), nullable=False),
    )

    op.create_table(
        "idea_blocks",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("session_name", sa.String(length=255), nullable=False),
        sa.Column("time_stamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("title", sa.String(length=10), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("transcript_id", sa.BigInteger(), sa.ForeignKey("transcript.id"), nullable=True),
        sa.Column("embedding_vector", Vector(1024), nullable=True),
        sa.Column("similarity_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("similarities.id"), nullable=True),
    )

    op.create_table(
        "task_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("idea_block_id", sa.BigInteger(), sa.ForeignKey("idea_blocks.id"), nullable=False),
        sa.Column("task_item_id", sa.BigInteger(), nullable=False),
    )

    op.create_table(
        "idea_block_to_transcript",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("idea_blocks_id", sa.BigInteger(), sa.ForeignKey("idea_blocks.id"), nullable=False),
        sa.Column("transcript_id", sa.BigInteger(), sa.ForeignKey("transcript.id"), nullable=False),
    )

    op.create_index("idx_idea_blocks_user_id", "idea_blocks", ["user_id"])
    op.create_index("idx_idea_blocks_session_name", "idea_blocks", ["session_name"])
    op.create_index("idx_idea_blocks_similarity_id", "idea_blocks", ["similarity_id"])
    op.create_index("idx_transcript_user_id", "transcript", ["user_id"])
    op.create_index("idx_transcript_session_id", "transcript", ["session_id"])


def downgrade() -> None:
    op.drop_index("idx_transcript_session_id", table_name="transcript")
    op.drop_index("idx_transcript_user_id", table_name="transcript")
    op.drop_index("idx_idea_blocks_similarity_id", table_name="idea_blocks")
    op.drop_index("idx_idea_blocks_session_name", table_name="idea_blocks")
    op.drop_index("idx_idea_blocks_user_id", table_name="idea_blocks")
    op.drop_table("idea_block_to_transcript")
    op.drop_table("task_items")
    op.drop_table("idea_blocks")
    op.drop_table("similarities")
    op.drop_table("transcript")
