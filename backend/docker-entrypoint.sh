#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS_ON_STARTUP:-1}" != "0" ]; then
  BASELINE_REVISION="${ALEMBIC_EXISTING_SCHEMA_REVISION:-20260607_0011}"
  set +e
  python - <<'PY'
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
            alembic_table = await connection.scalar(text("select to_regclass('public.alembic_version')"))
            revision_count = 0
            if alembic_table is not None:
                revision_count = int(await connection.scalar(text("select count(*) from alembic_version")) or 0)
    finally:
        await engine.dispose()

    if transcript_table is not None and revision_count == 0:
        return 10
    return 0


raise SystemExit(asyncio.run(main()))
PY
  baseline_status=$?
  set -e
  if [ "$baseline_status" = "10" ]; then
    echo "Existing database schema detected without Alembic revision; stamping ${BASELINE_REVISION}..."
    alembic -c alembic.ini stamp "${BASELINE_REVISION}"
  elif [ "$baseline_status" != "0" ]; then
    exit "$baseline_status"
  fi

  echo "Running database migrations..."
  alembic -c alembic.ini upgrade head
fi

exec "$@"
