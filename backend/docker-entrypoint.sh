#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS_ON_STARTUP:-1}" != "0" ]; then
  BASELINE_REVISION="${ALEMBIC_EXISTING_SCHEMA_REVISION:-}"
  set +e
  baseline_output="$(python - <<'PY'
import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import DATABASE_URL


async def main() -> int:
    engine = create_async_engine(DATABASE_URL)
    try:
        async with engine.connect() as connection:
            transcript_table = await connection.scalar(text("select to_regclass('public.transcript')"))
            phase_snapshot_table = await connection.scalar(text("select to_regclass('public.phase_task_item_snapshots')"))
            alembic_table = await connection.scalar(text("select to_regclass('public.alembic_version')"))
            versions = []
            revision_count = 0
            if alembic_table is not None:
                revision_count = int(await connection.scalar(text("select count(*) from alembic_version")) or 0)
                rows = await connection.execute(text("select version_num from alembic_version"))
                versions = [str(row[0]) for row in rows]
    finally:
        await engine.dispose()

    if transcript_table is not None and revision_count == 0:
        if phase_snapshot_table is not None:
            print("20260607_0011")
        else:
            print("20260531_0009")
        return 10
    if transcript_table is not None and phase_snapshot_table is None and versions:
        if any(version in {"20260607_0011", "20260608_0012"} for version in versions):
            print("20260531_0009")
            return 11
    return 0


raise SystemExit(asyncio.run(main()))
PY
)"
  baseline_status=$?
  set -e
  if [ "$baseline_status" = "10" ] || [ "$baseline_status" = "11" ]; then
    if [ -z "$BASELINE_REVISION" ]; then
      BASELINE_REVISION="$baseline_output"
    fi
    if [ "$baseline_status" = "11" ]; then
      echo "Alembic revision is ahead of the detected schema; repairing baseline to ${BASELINE_REVISION}..."
    else
      echo "Existing database schema detected without Alembic revision; stamping ${BASELINE_REVISION}..."
    fi
    alembic -c alembic.ini stamp "${BASELINE_REVISION}"
  elif [ "$baseline_status" != "0" ]; then
    exit "$baseline_status"
  fi

  echo "Running database migrations..."
  alembic -c alembic.ini upgrade head
fi

exec "$@"
