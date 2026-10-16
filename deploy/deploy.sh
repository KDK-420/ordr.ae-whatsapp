#!/usr/bin/env bash
# Build and (re)start the stack on the server. Run from anywhere:
#
#   /opt/ordr/deploy/deploy.sh            pull latest code, build, migrate, restart
#   /opt/ordr/deploy/deploy.sh --seed     also load the tenant and demo menu from SEED_* in .env
#   /opt/ordr/deploy/deploy.sh --no-pull  deploy the checked-out code as it is
#
# Migrations run automatically when the api container starts (see apps/api/docker-entrypoint.sh).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

SEED=0
PULL=1
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --no-pull) PULL=0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f .env ]; then
  echo "deploy/.env is missing. Copy deploy/.env.example or run deploy/bootstrap.sh first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

fail=0
for var in DOMAIN POSTGRES_PASSWORD META_APP_SECRET META_VERIFY_TOKEN; do
  val="${!var:-}"
  if [ -z "$val" ] || [ "$val" = "replace-me" ] || [ "$val" = "wa.example.com" ]; then
    echo "deploy/.env: $var is not set" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1

if [ "$PULL" -eq 1 ]; then
  echo "==> Pulling latest code"
  git -C "$DIR/.." pull --ff-only
fi

echo "==> Building API image"
docker compose build --pull api

echo "==> Starting services"
docker compose up -d --remove-orphans

echo "==> Waiting for the API to report healthy"
api_id="$(docker compose ps -q api)"
for _ in $(seq 1 40); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$api_id" 2>/dev/null || echo starting)"
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 3
done
if [ "${status:-}" != "healthy" ]; then
  echo "API did not become healthy. Recent logs:" >&2
  docker compose logs --tail=50 api >&2
  exit 1
fi

if [ "$SEED" -eq 1 ]; then
  echo "==> Seeding tenant, channel and demo menu"
  docker compose exec -T api sh -c 'cd /app/apps/api && ./node_modules/.bin/tsx prisma/seed.ts'
fi

docker compose ps
cat <<DONE

Deployed. Webhook settings for the Meta app dashboard (WhatsApp > Configuration):

  Callback URL:  https://$DOMAIN/webhooks/whatsapp
  Verify token:  $META_VERIFY_TOKEN

Health:  https://$DOMAIN/health
Logs:    cd $DIR && docker compose logs -f api
DONE
