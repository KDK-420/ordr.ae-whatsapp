#!/bin/sh
# Container entrypoint: apply pending Prisma migrations, then start the API.
set -eu
cd "$(dirname "$0")"
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] applying database migrations"
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[entrypoint] DATABASE_URL not set, running with in-memory storage"
fi
exec node dist/main.js
