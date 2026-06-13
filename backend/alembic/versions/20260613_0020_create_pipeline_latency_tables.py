"""create pipeline latency tables

Revision ID: 20260613_0020
Revises: 20260612_0019
Create Date: 2026-06-13
"""

from alembic import op
import sqlalchemy as sa


revision = "20260613_0020"
down_revision = "20260612_0019"
branch_labels = None
depends_on = None


DECISIONS_TABLE = "transcript_generation_decisions"
EVENTS_TABLE = "pipeline_latency_events"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if DECISIONS_TABLE not in tables:
        op.create_table(
            DECISIONS_TABLE,
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("pipeline_run_id", sa.String(length=64), nullable=False),
            sa.Column("session_name", sa.String(length=255), nullable=False),
            sa.Column("task_name", sa.String(length=80), nullable=False),
            sa.Column("condition", sa.String(length=32), server_default="unknown", nullable=False),
            sa.Column("phase", sa.String(length=80), server_default="unknown", nullable=False),
            sa.Column("participant_id", sa.String(length=255), nullable=False),
            sa.Column("scope", sa.String(length=32), nullable=False),
            sa.Column("transcript_id", sa.BigInteger(), nullable=True),
            sa.Column("client_segment_ids", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
            sa.Column("segment_cut_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("transcript_saved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_done_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("cut_to_decision_ms", sa.Integer(), nullable=True),
            sa.Column("save_to_decision_ms", sa.Integer(), nullable=True),
            sa.Column("decision", sa.String(length=64), nullable=False),
            sa.Column("generated_idea_block_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("duplicate_idea_block_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("transcript_chars", sa.Integer(), server_default="0", nullable=False),
            sa.Column("session_transcript_count_before", sa.Integer(), nullable=True),
            sa.Column("session_idea_block_count_before", sa.Integer(), nullable=True),
            sa.Column("participant_idea_block_count_before", sa.Integer(), nullable=True),
            sa.Column("skipped_reason", sa.String(length=120), nullable=True),
            sa.Column("error_type", sa.String(length=120), nullable=True),
            sa.Column("metadata", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("pipeline_run_id", name="uq_transcript_generation_decisions_pipeline_run_id"),
        )

    if EVENTS_TABLE not in tables:
        op.create_table(
            EVENTS_TABLE,
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("pipeline_run_id", sa.String(length=64), nullable=False),
            sa.Column("session_name", sa.String(length=255), nullable=False),
            sa.Column("task_name", sa.String(length=80), nullable=False),
            sa.Column("condition", sa.String(length=32), server_default="unknown", nullable=False),
            sa.Column("phase", sa.String(length=80), server_default="unknown", nullable=False),
            sa.Column("participant_id", sa.String(length=255), nullable=False),
            sa.Column("scope", sa.String(length=32), nullable=False),
            sa.Column("transcript_id", sa.BigInteger(), nullable=True),
            sa.Column("stage", sa.String(length=80), nullable=False),
            sa.Column("duration_ms", sa.Integer(), nullable=False),
            sa.Column("meeting_elapsed_ms", sa.Integer(), nullable=True),
            sa.Column("phase_elapsed_ms", sa.Integer(), nullable=True),
            sa.Column("transcript_chars", sa.Integer(), server_default="0", nullable=False),
            sa.Column("session_transcript_count_before", sa.Integer(), nullable=True),
            sa.Column("session_idea_block_count_before", sa.Integer(), nullable=True),
            sa.Column("participant_idea_block_count_before", sa.Integer(), nullable=True),
            sa.Column("candidate_count", sa.Integer(), nullable=True),
            sa.Column("llm_model", sa.String(length=120), nullable=True),
            sa.Column("llm_input_tokens", sa.Integer(), nullable=True),
            sa.Column("llm_output_tokens", sa.Integer(), nullable=True),
            sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("metadata", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_pipeline_run_id ON {DECISIONS_TABLE} (pipeline_run_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_session_name ON {DECISIONS_TABLE} (session_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_task_name ON {DECISIONS_TABLE} (task_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_condition ON {DECISIONS_TABLE} (condition)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_phase ON {DECISIONS_TABLE} (phase)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_participant_id ON {DECISIONS_TABLE} (participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_scope ON {DECISIONS_TABLE} (scope)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_transcript_id ON {DECISIONS_TABLE} (transcript_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_decision_done_at ON {DECISIONS_TABLE} (decision_done_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{DECISIONS_TABLE}_created_at ON {DECISIONS_TABLE} (created_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{DECISIONS_TABLE}_session_task ON {DECISIONS_TABLE} (session_name, task_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{DECISIONS_TABLE}_transcript ON {DECISIONS_TABLE} (transcript_id)")

    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_pipeline_run_id ON {EVENTS_TABLE} (pipeline_run_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_session_name ON {EVENTS_TABLE} (session_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_task_name ON {EVENTS_TABLE} (task_name)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_condition ON {EVENTS_TABLE} (condition)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_phase ON {EVENTS_TABLE} (phase)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_participant_id ON {EVENTS_TABLE} (participant_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_scope ON {EVENTS_TABLE} (scope)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_transcript_id ON {EVENTS_TABLE} (transcript_id)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_stage ON {EVENTS_TABLE} (stage)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{EVENTS_TABLE}_created_at ON {EVENTS_TABLE} (created_at)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{EVENTS_TABLE}_pipeline_stage ON {EVENTS_TABLE} (pipeline_run_id, stage)")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_{EVENTS_TABLE}_session_task ON {EVENTS_TABLE} (session_name, task_name)")


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS idx_{EVENTS_TABLE}_session_task")
    op.execute(f"DROP INDEX IF EXISTS idx_{EVENTS_TABLE}_pipeline_stage")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_created_at")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_stage")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_transcript_id")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_scope")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_participant_id")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_phase")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_condition")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_task_name")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_session_name")
    op.execute(f"DROP INDEX IF EXISTS ix_{EVENTS_TABLE}_pipeline_run_id")
    op.execute(f"DROP TABLE IF EXISTS {EVENTS_TABLE}")

    op.execute(f"DROP INDEX IF EXISTS idx_{DECISIONS_TABLE}_transcript")
    op.execute(f"DROP INDEX IF EXISTS idx_{DECISIONS_TABLE}_session_task")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_created_at")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_decision_done_at")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_transcript_id")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_scope")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_participant_id")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_phase")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_condition")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_task_name")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_session_name")
    op.execute(f"DROP INDEX IF EXISTS ix_{DECISIONS_TABLE}_pipeline_run_id")
    op.execute(f"DROP TABLE IF EXISTS {DECISIONS_TABLE}")
