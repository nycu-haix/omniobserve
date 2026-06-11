"""create ranking phase snapshots

Revision ID: 20260612_0017
Revises: 20260612_0016
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0017"
down_revision = "20260612_0016"
branch_labels = None
depends_on = None


SNAPSHOT_TABLE = "ranking_phase_snapshots"
SNAPSHOT_ITEMS_TABLE = "ranking_phase_snapshot_items"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if SNAPSHOT_TABLE not in tables:
        op.create_table(
            SNAPSHOT_TABLE,
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("session_name", sa.String(length=255), nullable=False),
            sa.Column("task_id", sa.String(length=80), nullable=False),
            sa.Column("condition", sa.String(length=32), server_default="experimental", nullable=False),
            sa.Column("cue_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("phase", sa.String(length=80), nullable=False),
            sa.Column("scope", sa.String(length=16), nullable=False),
            sa.Column("subject_type", sa.String(length=32), nullable=False),
            sa.Column("subject_id", sa.String(length=255), nullable=False),
            sa.Column("participant_id", sa.String(length=255), nullable=True),
            sa.Column("group_id", sa.String(length=255), nullable=False),
            sa.Column("source", sa.String(length=80), server_default="phase_boundary", nullable=False),
            sa.Column("source_phase", sa.String(length=80), nullable=True),
            sa.Column("next_phase", sa.String(length=80), nullable=True),
            sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
            sa.Column("change_count", sa.Integer(), nullable=True),
            sa.Column("ranking_move_id", sa.BigInteger(), nullable=True),
            sa.Column("item_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_session_name ON {SNAPSHOT_TABLE} (session_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_task_id ON {SNAPSHOT_TABLE} (task_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_condition ON {SNAPSHOT_TABLE} (condition)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_cue_enabled ON {SNAPSHOT_TABLE} (cue_enabled)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_phase ON {SNAPSHOT_TABLE} (phase)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_scope ON {SNAPSHOT_TABLE} (scope)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_subject_type ON {SNAPSHOT_TABLE} (subject_type)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_subject_id ON {SNAPSHOT_TABLE} (subject_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_participant_id ON {SNAPSHOT_TABLE} (participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_group_id ON {SNAPSHOT_TABLE} (group_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_source ON {SNAPSHOT_TABLE} (source)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_ranking_move_id ON {SNAPSHOT_TABLE} (ranking_move_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_TABLE}_created_at ON {SNAPSHOT_TABLE} (created_at)")
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{SNAPSHOT_TABLE}_session_task_phase "
        f"ON {SNAPSHOT_TABLE} (session_name, task_id, phase)"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{SNAPSHOT_TABLE}_session_scope_subject "
        f"ON {SNAPSHOT_TABLE} (session_name, scope, subject_id)"
    )

    if SNAPSHOT_ITEMS_TABLE not in tables:
        op.create_table(
            SNAPSHOT_ITEMS_TABLE,
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("snapshot_id", sa.BigInteger(), nullable=False),
            sa.Column("item_id", sa.String(length=255), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("label", sa.Text(), nullable=True),
            sa.Column("source_metadata", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(["snapshot_id"], [f"{SNAPSHOT_TABLE}.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("snapshot_id", "position", name="uq_ranking_phase_snapshot_items_snapshot_position"),
        )

    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_ITEMS_TABLE}_snapshot_id ON {SNAPSHOT_ITEMS_TABLE} (snapshot_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_ITEMS_TABLE}_item_id ON {SNAPSHOT_ITEMS_TABLE} (item_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{SNAPSHOT_ITEMS_TABLE}_position ON {SNAPSHOT_ITEMS_TABLE} (position)")
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{SNAPSHOT_ITEMS_TABLE}_snapshot_position "
        f"ON {SNAPSHOT_ITEMS_TABLE} (snapshot_id, position)"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{SNAPSHOT_ITEMS_TABLE}_item_id "
        f"ON {SNAPSHOT_ITEMS_TABLE} (item_id)"
    )


def downgrade() -> None:
    op.drop_index(f"idx_{SNAPSHOT_ITEMS_TABLE}_item_id", table_name=SNAPSHOT_ITEMS_TABLE)
    op.drop_index(f"idx_{SNAPSHOT_ITEMS_TABLE}_snapshot_position", table_name=SNAPSHOT_ITEMS_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_ITEMS_TABLE}_position", table_name=SNAPSHOT_ITEMS_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_ITEMS_TABLE}_item_id", table_name=SNAPSHOT_ITEMS_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_ITEMS_TABLE}_snapshot_id", table_name=SNAPSHOT_ITEMS_TABLE)
    op.drop_table(SNAPSHOT_ITEMS_TABLE)
    op.drop_index(f"idx_{SNAPSHOT_TABLE}_session_scope_subject", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"idx_{SNAPSHOT_TABLE}_session_task_phase", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_created_at", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_ranking_move_id", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_source", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_group_id", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_participant_id", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_subject_id", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_subject_type", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_scope", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_phase", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_cue_enabled", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_condition", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_task_id", table_name=SNAPSHOT_TABLE)
    op.drop_index(f"ix_{SNAPSHOT_TABLE}_session_name", table_name=SNAPSHOT_TABLE)
    op.drop_table(SNAPSHOT_TABLE)
