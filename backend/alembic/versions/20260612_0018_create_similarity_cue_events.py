"""create similarity cue events

Revision ID: 20260612_0018
Revises: 20260612_0017
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0018"
down_revision = "20260612_0017"
branch_labels = None
depends_on = None


TABLE = "similarity_cue_events"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if TABLE not in tables:
        op.create_table(
            TABLE,
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("cue_id", sa.String(length=255), nullable=False),
            sa.Column("event_type", sa.String(length=80), server_default="similarity_cue", nullable=False),
            sa.Column("source", sa.String(length=80), server_default="similarity_pair", nullable=False),
            sa.Column("session_name", sa.String(length=255), nullable=False),
            sa.Column("task_id", sa.String(length=80), nullable=False),
            sa.Column("group_id", sa.String(length=255), nullable=False),
            sa.Column("condition", sa.String(length=32), server_default="experimental", nullable=False),
            sa.Column("cue_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("phase", sa.String(length=80), server_default="unknown", nullable=False),
            sa.Column("cue_type", sa.String(length=80), server_default="same_reason", nullable=False),
            sa.Column("sender_participant_id", sa.String(length=255), nullable=True),
            sa.Column("recipient_participant_id", sa.String(length=255), nullable=False),
            sa.Column("similarity_id", sa.BigInteger(), nullable=True),
            sa.Column("own_idea_block_id", sa.BigInteger(), nullable=True),
            sa.Column("other_idea_block_id", sa.BigInteger(), nullable=True),
            sa.Column("reason", sa.Text(), server_default="", nullable=False),
            sa.Column("delivery_status", sa.String(length=32), server_default="pending", nullable=False),
            sa.Column("response_status", sa.String(length=32), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("shown_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ignored_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("metadata", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["similarity_id"], ["similarities.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["own_idea_block_id"], ["idea_blocks.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["other_idea_block_id"], ["idea_blocks.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("session_name", "cue_id", name="uq_similarity_cue_events_session_cue_id"),
        )

    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_cue_id ON {TABLE} (cue_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_event_type ON {TABLE} (event_type)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_session_name ON {TABLE} (session_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_task_id ON {TABLE} (task_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_group_id ON {TABLE} (group_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_condition ON {TABLE} (condition)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_cue_enabled ON {TABLE} (cue_enabled)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_phase ON {TABLE} (phase)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_cue_type ON {TABLE} (cue_type)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_sender_participant_id ON {TABLE} (sender_participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_recipient_participant_id ON {TABLE} (recipient_participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_similarity_id ON {TABLE} (similarity_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_own_idea_block_id ON {TABLE} (own_idea_block_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_other_idea_block_id ON {TABLE} (other_idea_block_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_delivery_status ON {TABLE} (delivery_status)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_response_status ON {TABLE} (response_status)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_delivered_at ON {TABLE} (delivered_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_shown_at ON {TABLE} (shown_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_responded_at ON {TABLE} (responded_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_created_at ON {TABLE} (created_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_updated_at ON {TABLE} (updated_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_session_task ON {TABLE} (session_name, task_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_session_recipient ON {TABLE} (session_name, recipient_participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_similarity ON {TABLE} (similarity_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_own_block ON {TABLE} (own_idea_block_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_other_block ON {TABLE} (other_idea_block_id)")


def downgrade() -> None:
    op.drop_index(f"idx_{TABLE}_other_block", table_name=TABLE)
    op.drop_index(f"idx_{TABLE}_own_block", table_name=TABLE)
    op.drop_index(f"idx_{TABLE}_similarity", table_name=TABLE)
    op.drop_index(f"idx_{TABLE}_session_recipient", table_name=TABLE)
    op.drop_index(f"idx_{TABLE}_session_task", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_updated_at", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_created_at", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_responded_at", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_shown_at", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_delivered_at", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_response_status", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_delivery_status", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_other_idea_block_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_own_idea_block_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_similarity_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_recipient_participant_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_sender_participant_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_cue_type", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_phase", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_cue_enabled", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_condition", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_group_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_task_id", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_session_name", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_event_type", table_name=TABLE)
    op.drop_index(f"ix_{TABLE}_cue_id", table_name=TABLE)
    op.drop_table(TABLE)
