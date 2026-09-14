"""include statement in snapshot item dedupe

Revision ID: 20260612_0015
Revises: 20260608_0014
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0015"
down_revision = "20260608_0014"
branch_labels = None
depends_on = None


CONSTRAINT_NAME = "uq_phase_task_item_snapshot_items_dedupe_key"
TABLE_NAME = "phase_task_item_snapshot_items"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return

    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints(TABLE_NAME)}
    if CONSTRAINT_NAME in unique_constraints:
        op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="unique")
    op.create_unique_constraint(
        CONSTRAINT_NAME,
        TABLE_NAME,
        ["snapshot_id", "component_id", "action_id", "statement"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return

    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints(TABLE_NAME)}
    if CONSTRAINT_NAME in unique_constraints:
        op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="unique")
    op.create_unique_constraint(
        CONSTRAINT_NAME,
        TABLE_NAME,
        ["snapshot_id", "component_id", "action_id"],
    )
