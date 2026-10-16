#!/usr/bin/env bash
# Dump the Postgres database to $BACKUP_DIR (default /opt/ordr/backups) and prune old dumps.
# bootstrap.sh schedules this nightly. Copy the backups directory off the server regularly.
#
# Restore a dump into the running stack:
#   cd /opt/ordr/deploy
#   docker compose exec -T postgres pg_restore -U ordr -d ordr --clean --if-exists < /opt/ordr/backups/ordr-<stamp>.dump
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$DIR/../backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/ordr-$stamp.dump"

cd "$DIR"
docker compose exec -T postgres pg_dump -U ordr -d ordr --format=custom > "$out"
find "$BACKUP_DIR" -name 'ordr-*.dump' -mtime "+$KEEP_DAYS" -delete
echo "backup written: $out ($(du -h "$out" | cut -f1))"
