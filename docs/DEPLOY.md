# Deploying to a single VPS

One server runs everything: Postgres, Redis, the API, and Caddy for TLS. Everything lives in
`deploy/`. Suits a pilot with a handful of merchants; see "Growing out of it" at the end.

Requirements: a VPS with Ubuntu 22.04/24.04 or Debian 12, 2 GB RAM or more, root access, and a
hostname whose DNS A record points at the server (for example `wa.ordr.ae`). For UAE data
residency (PLAN.md, ADR-007) pick a provider with a UAE location.

## Option A: from GitHub Actions (no local SSH needed)

The `VPS` workflow (`.github/workflows/vps.yml`) does steps 1 to 3 below over SSH from a
GitHub-hosted runner. It needs the repository secret `VPS_PASSWORD` (root password). Optional
secrets `META_APP_SECRET`, `META_VERIFY_TOKEN` and the `SEED_*` values are written into
`deploy/.env` on the server when present; otherwise fill them in by hand on the server.

Actions tab > VPS > Run workflow. Inputs: `host`, `domain` (defaults to a sslip.io name derived
from the IP, which resolves without DNS setup), `mode` (`setup` the first time, `deploy` for
updates). The run summary prints the health and webhook URLs.

## Option B: by hand

### 1. Prepare the server (once)

```
ssh root@<server-ip>
curl -fsSL https://raw.githubusercontent.com/KDK-420/ordr.ae-whatsapp/main/deploy/bootstrap.sh | bash
```

`bootstrap.sh` installs Docker, allows only SSH, 80 and 443 through the firewall, enables
unattended security updates, clones the repository to `/opt/ordr`, creates `/opt/ordr/deploy/.env`
with a generated Postgres password and webhook verify token, and schedules a nightly backup.
Running it again is safe.

### 2. Fill in the configuration

```
nano /opt/ordr/deploy/.env
```

Set `DOMAIN`, `META_APP_SECRET`, and the `SEED_*` values (phone number ID, WABA ID, display
number, permanent access token) from the Meta app dashboard. Leave the generated values alone.

### 3. Deploy

```
/opt/ordr/deploy/deploy.sh --seed
```

This builds the API image, starts the four services, waits for the health check, applies
migrations (the container does this at startup), and loads the tenant plus demo menu. It ends by
printing the webhook callback URL and verify token.

Caddy obtains the TLS certificate on first request, so `https://<DOMAIN>/health` may take a few
seconds the first time.

## Register the webhook with Meta

In the Meta app dashboard, WhatsApp > Configuration > Webhook: paste the callback URL
`https://<DOMAIN>/webhooks/whatsapp` and the verify token from `deploy/.env`, click Verify and
save, then subscribe to the `messages` field. Send "hi" to the number and watch
`docker compose logs -f api`.

## Day-to-day

All commands from `/opt/ordr/deploy`.

| Task | Command |
|------|---------|
| Ship a new version | `./deploy.sh` (pulls main, rebuilds, restarts, migrates) |
| Tail logs | `docker compose logs -f api` |
| Service status | `docker compose ps` |
| Restart the API only | `docker compose restart api` |
| Change configuration | edit `.env`, then `docker compose up -d` |
| Back up now | `./backup.sh` (nightly at 03:00 via `/etc/cron.d/ordr-backup`) |
| Restore | `docker compose exec -T postgres pg_restore -U ordr -d ordr --clean --if-exists < ../backups/ordr-<stamp>.dump` |
| Open a psql shell | `docker compose exec postgres psql -U ordr ordr` |
| Reseed demo data | `./deploy.sh --no-pull --seed` |

Backups land in `/opt/ordr/backups` and are kept for 14 days. Copy them off the server (rsync,
object storage) because a VPS has no managed backups.

## Hardening after the first login

The bootstrap does not touch SSH so it cannot lock you out. Once you can log in with a key:

```
ssh-copy-id root@<server-ip>          # from your machine
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

Test the key login in a second terminal before closing the first one.

## How it fits together

- `apps/api/Dockerfile` builds the whole monorepo with pnpm and keeps `node_modules` in the runtime
  image so `prisma migrate deploy` and the seed script work inside the container.
- `apps/api/docker-entrypoint.sh` runs migrations, then starts `node dist/main.js`.
- `deploy/compose.yml` wires the services. Postgres and Redis are reachable only on the Docker
  network. `DATABASE_URL` and `REDIS_URL` are set there, not in `.env`.
- `deploy/Caddyfile` proxies `DOMAIN` to the API on port 3000 with automatic certificates.

## Growing out of it

The box is a single point of failure. When that matters, move Postgres to a managed instance
(point `DATABASE_URL` in `compose.yml` at it and drop the postgres service) before moving anything
else. The worker and dashboard apps from the roadmap can join this compose file as extra services.
