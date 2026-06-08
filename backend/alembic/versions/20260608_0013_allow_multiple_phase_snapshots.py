"""allow multiple phase task item snapshots

Revision ID: 20260608_0013
Revises: 20260608_0012
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa


revision = "20260608_0013"
down_revision = "20260608_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "phase_task_item_snapshots" not in inspector.get_table_names():
        return
    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("phase_task_item_snapshots")}
    if "uq_phase_task_item_snapshots_session_task_phase" in unique_constraints:
        op.drop_constraint(
            "uq_phase_task_item_snapshots_session_task_phase",
            "phase_task_item_snapshots",
            type_="unique",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "phase_task_item_snapshots" not in inspector.get_table_names():
        return
    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints("phase_task_item_snapshots")}
    if "uq_phase_task_item_snapshots_session_task_phase" not in unique_constraints:
        op.create_unique_constraint(
            "uq_phase_task_item_snapshots_session_task_phase",
            "phase_task_item_snapshots",
            ["session_name", "task_id", "to_phase"],
        )
