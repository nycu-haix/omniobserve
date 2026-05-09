"""create chat messages

Revision ID: 20260509_0005
Revises: 20260507_0004
Create Date: 2026-05-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260509_0005"
down_revision: Union[str, None] = "20260507_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("session_name", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("time_stamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("idx_chat_messages_session_name", "chat_messages", ["session_name"])
    op.create_index("idx_chat_messages_user_id", "chat_messages", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_chat_messages_user_id", table_name="chat_messages")
    op.drop_index("idx_chat_messages_session_name", table_name="chat_messages")
    op.drop_table("chat_messages")
