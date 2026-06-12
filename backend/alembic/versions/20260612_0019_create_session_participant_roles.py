"""create session participant roles

Revision ID: 20260612_0019
Revises: 20260612_0018
Create Date: 2026-06-12
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612_0019"
down_revision = "20260612_0018"
branch_labels = None
depends_on = None


TABLE = "session_participant_roles"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if TABLE not in tables:
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("session_name", sa.String(length=255), nullable=False),
            sa.Column("participant_id", sa.String(length=255), nullable=False),
            sa.Column("participant_role", sa.String(length=32), server_default="participant", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("session_name", "participant_id", name="uq_session_participant_roles_session_participant"),
        )

    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_session_name ON {TABLE} (session_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_participant_id ON {TABLE} (participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_participant_role ON {TABLE} (participant_role)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{TABLE}_session_role ON {TABLE} (session_name, participant_role)")


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS idx_{TABLE}_session_role")
    op.execute(f"DROP INDEX IF EXISTS ix_{TABLE}_participant_role")
    op.execute(f"DROP INDEX IF EXISTS ix_{TABLE}_participant_id")
    op.execute(f"DROP INDEX IF EXISTS ix_{TABLE}_session_name")
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
