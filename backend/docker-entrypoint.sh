#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS_ON_STARTUP:-1}" != "0" ]; then
  echo "Running database migrations..."
  alembic -c alembic.ini upgrade head
fi

exec "$@"
