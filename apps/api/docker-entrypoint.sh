#!/bin/sh
# Container entrypoint: apply pending Prisma migrations, then run the given command
# (default: the API). The worker runs the same image with `node dist/worker.js` and
# SKIP_MIGRATIONS=1, since the API container already migrates.
set -eu
cd "$(dirname "$0")"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL not set, running with in-memory storage"
elif [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] SKIP_MIGRATIONS=1, not touching the schema"
else
  echo "[entrypoint] applying database migrations"
  ./node_modules/.bin/prisma migrate deploy
fi
if [ "$#" -eq 0 ]; then
  set -- node dist/main.js
fi
exec "$@"
