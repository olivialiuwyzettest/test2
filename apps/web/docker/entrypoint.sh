#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required (e.g. file:/data/dev.db)" >&2
  exit 1
fi

# Prisma + SQLite requires the target file to exist.
case "$DATABASE_URL" in
  file:/*)
    DB_PATH="${DATABASE_URL#file:}"
    mkdir -p "$(dirname "$DB_PATH")"
    touch "$DB_PATH"
    ;;
esac

if [ "${RUN_DB_SETUP:-true}" = "true" ]; then
  echo "Running migrations..."
  npx prisma migrate deploy

  echo "Seeding (safe to re-run)..."
  npx prisma db seed || true
fi

exec "$@"
