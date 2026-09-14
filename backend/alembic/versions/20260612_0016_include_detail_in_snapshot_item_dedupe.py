"""include detail in snapshot item dedupe

Revision ID: 20260612_0016
Revises: 20260612_0015
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0016"
down_revision = "20260612_0015"
branch_labels = None
depends_on = None


CONSTRAINT_NAME = "uq_phase_task_item_snapshot_items_dedupe_key"
TABLE_NAME = "phase_task_item_snapshot_items"
DETAIL_COLUMN_NAME = "detail"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if DETAIL_COLUMN_NAME not in columns:
        op.add_column(
            TABLE_NAME,
            sa.Column(DETAIL_COLUMN_NAME, sa.Text(), nullable=False, server_default=""),
        )
    op.execute(
        sa.text(
            """
            UPDATE phase_task_item_snapshot_items
            SET detail = COALESCE(
                (
                    SELECT private_phase_task_items.detail
                    FROM private_phase_task_items
                    WHERE private_phase_task_items.id =
                        phase_task_item_snapshot_items.representative_private_phase_task_item_id
                ),
                ''
            )
            WHERE detail IS NULL OR detail = ''
            """
        )
    )

    unique_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints(TABLE_NAME)}
    if CONSTRAINT_NAME in unique_constraints:
        op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="unique")
    op.create_unique_constraint(
        CONSTRAINT_NAME,
        TABLE_NAME,
        ["snapshot_id", "component_id", "action_id", "detail"],
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
        ["snapshot_id", "component_id", "action_id", "statement"],
    )
    columns = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if DETAIL_COLUMN_NAME in columns:
        op.drop_column(TABLE_NAME, DETAIL_COLUMN_NAME)
