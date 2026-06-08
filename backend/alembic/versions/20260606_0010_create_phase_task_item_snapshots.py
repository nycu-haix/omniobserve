"""create phase task item snapshots

Revision ID: 20260606_0010
Revises: 20260531_0009
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa


revision = "20260606_0010"
down_revision = "20260531_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS poster_task_items")

    op.create_table(
        "phase_task_item_snapshots",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_name", sa.String(length=255), nullable=False),
        sa.Column("task_id", sa.String(length=80), nullable=False),
        sa.Column("from_phase", sa.String(length=80), nullable=False),
        sa.Column("to_phase", sa.String(length=80), nullable=False),
        sa.Column("shuffle_seed", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_name", "task_id", "to_phase", name="uq_phase_task_item_snapshots_session_task_phase"),
    )
    op.create_index("ix_phase_task_item_snapshots_session_name", "phase_task_item_snapshots", ["session_name"])
    op.create_index("ix_phase_task_item_snapshots_task_id", "phase_task_item_snapshots", ["task_id"])
    op.create_index("ix_phase_task_item_snapshots_to_phase", "phase_task_item_snapshots", ["to_phase"])
    op.create_index(
        "idx_phase_task_item_snapshots_session_task",
        "phase_task_item_snapshots",
        ["session_name", "task_id"],
    )

    op.create_table(
        "phase_task_item_snapshot_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("representative_private_phase_task_item_id", sa.BigInteger(), nullable=True),
        sa.Column("component_id", sa.String(length=80), nullable=False),
        sa.Column("component_label", sa.String(length=120), nullable=False),
        sa.Column("action_id", sa.String(length=80), nullable=False),
        sa.Column("action_label", sa.String(length=120), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("source_user_ids", sa.JSON(), nullable=False),
        sa.Column("source_priorities", sa.JSON(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["snapshot_id"], ["phase_task_item_snapshots.id"]),
        sa.ForeignKeyConstraint(["representative_private_phase_task_item_id"], ["private_phase_task_items.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("snapshot_id", "component_id", "action_id", name="uq_phase_task_item_snapshot_items_dedupe_key"),
    )
    op.create_index("ix_phase_task_item_snapshot_items_snapshot_id", "phase_task_item_snapshot_items", ["snapshot_id"])
    op.create_index(
        "ix_phase_snapshot_items_representative_item_id",
        "phase_task_item_snapshot_items",
        ["representative_private_phase_task_item_id"],
    )
    op.create_index("ix_phase_task_item_snapshot_items_position", "phase_task_item_snapshot_items", ["position"])
    op.create_index("idx_phase_task_item_snapshot_items_component", "phase_task_item_snapshot_items", ["component_id"])
    op.create_index(
        "idx_phase_task_item_snapshot_items_snapshot_position",
        "phase_task_item_snapshot_items",
        ["snapshot_id", "position"],
    )

    op.drop_table("poster_idea_block_task_items")
    op.create_table(
        "poster_idea_block_task_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("idea_block_id", sa.BigInteger(), nullable=False),
        sa.Column("component_id", sa.String(length=80), nullable=False),
        sa.Column("action_id", sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(["idea_block_id"], ["idea_blocks.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "idea_block_id",
            "component_id",
            "action_id",
            name="uq_poster_idea_block_task_items_block_component_action",
        ),
    )
    op.create_index("ix_poster_idea_block_task_items_idea_block_id", "poster_idea_block_task_items", ["idea_block_id"])
    op.create_index("idx_poster_idea_block_task_items_component", "poster_idea_block_task_items", ["component_id"])


def downgrade() -> None:
    op.drop_index("idx_poster_idea_block_task_items_component", table_name="poster_idea_block_task_items")
    op.drop_index("ix_poster_idea_block_task_items_idea_block_id", table_name="poster_idea_block_task_items")
    op.drop_table("poster_idea_block_task_items")
    op.create_table(
        "poster_idea_block_task_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("idea_block_id", sa.BigInteger(), nullable=False),
        sa.Column("poster_component", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("advanced_action", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["idea_block_id"], ["idea_blocks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_poster_idea_block_task_items_idea_block_id", "poster_idea_block_task_items", ["idea_block_id"])
    op.create_index(
        "idx_poster_idea_block_task_items_triple",
        "poster_idea_block_task_items",
        ["poster_component", "action", "advanced_action"],
    )

    op.drop_index("idx_phase_task_item_snapshot_items_snapshot_position", table_name="phase_task_item_snapshot_items")
    op.drop_index("idx_phase_task_item_snapshot_items_component", table_name="phase_task_item_snapshot_items")
    op.drop_index("ix_phase_task_item_snapshot_items_position", table_name="phase_task_item_snapshot_items")
    op.drop_index(
        "ix_phase_snapshot_items_representative_item_id",
        table_name="phase_task_item_snapshot_items",
    )
    op.drop_index("ix_phase_task_item_snapshot_items_snapshot_id", table_name="phase_task_item_snapshot_items")
    op.drop_table("phase_task_item_snapshot_items")
    op.drop_index("idx_phase_task_item_snapshots_session_task", table_name="phase_task_item_snapshots")
    op.drop_index("ix_phase_task_item_snapshots_to_phase", table_name="phase_task_item_snapshots")
    op.drop_index("ix_phase_task_item_snapshots_task_id", table_name="phase_task_item_snapshots")
    op.drop_index("ix_phase_task_item_snapshots_session_name", table_name="phase_task_item_snapshots")
    op.drop_table("phase_task_item_snapshots")
    op.create_table(
        "poster_task_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("task_name", sa.String(length=64), nullable=False),
        sa.Column("session_name", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("poster_component", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("advanced_action", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("action IN ('add', 'remove', 'edit')", name="ck_poster_task_items_action"),
    )
