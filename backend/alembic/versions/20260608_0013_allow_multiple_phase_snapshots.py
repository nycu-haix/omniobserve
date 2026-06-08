"""allow multiple phase task item snapshots

Revision ID: 20260608_0013
Revises: 20260608_0012
Create Date: 2026-06-08
"""

from alembic import op


revision = "20260608_0013"
down_revision = "20260608_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_phase_task_item_snapshots_session_task_phase",
        "phase_task_item_snapshots",
        type_="unique",
    )


def downgrade() -> None:
    op.create_unique_constraint(
        "uq_phase_task_item_snapshots_session_task_phase",
        "phase_task_item_snapshots",
        ["session_name", "task_id", "to_phase"],
    )
