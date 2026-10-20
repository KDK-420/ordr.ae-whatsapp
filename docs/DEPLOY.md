# Deploying to a single VPS

One server runs everything: Postgres, Redis, the API, the worker, the merchant dashboard, and
Caddy for TLS. The worker is the API image started with `node dist/worker.js`; it relays
outbox events (customer notifications) with retries.
Everything lives in `deploy/`. Suits a pilot with a handful of merchants; see "Growing out of it"
at the end.

Caddy routes `/health`, `/webhooks/*` and `/merchant/*` to the API and everything else to the
dashboard, so one hostname serves the landing page (`/`), the dashboard (`/login`, `/orders`)
and the WhatsApp webhook.

Requirements: a VPS with Ubuntu 22.04/24.04 or Debian 12, 2 GB RAM or more, root access, and a
hostname whose DNS A record points at the server (`app.ordr.ae`). For UAE data
residency (PLAN.md, ADR-007) pick a provider with a UAE location.

## Option A: from GitHub Actions (no local SSH needed)

The `VPS` workflow (`.github/workflows/vps.yml`) does steps 1 to 3 below over SSH from a
GitHub-hosted runner. Optional secrets `META_APP_SECRET`, `META_VERIFY_TOKEN`, `AUTH_SECRET`,
`ANTHROPIC_API_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and the other `SEED_*` values
are written into `deploy/.env` on the server on every run (setup and deploy) when present, so
adding or rotating a secret in GitHub only needs a `deploy` run; empty secrets never blank a
value already on the server. The bootstrap generates `AUTH_SECRET` and a `SEED_ADMIN_PASSWORD`
when they are empty; read the generated password with `grep SEED_ADMIN /opt/ordr/deploy/.env`
on the server.

`ANTHROPIC_API_KEY` turns on the Claude assistant (free-text understanding, matching typed
answers to the options shown, "Draft with AI" in the inbox). Without it every flow still works,
just menu-driven. The model is `ANTHROPIC_MODEL` in `deploy/.env` (default `claude-opus-5-5`).

Actions tab > VPS > Run workflow. Inputs: `host`, `domain` (default `app.ordr.ae`; the run fails
early if its A record does not point at the server), `mode` (`setup` the first time, `deploy` for
updates), `seed` (`salon`, `restaurant` or `retail` reseeds the demo tenant as that vertical and
moves the WhatsApp number and the owner login to it; `no` leaves data alone), `ssh_public_key`,
`disable_password_auth`. The run summary prints the health, web chat and webhook URLs, whether
the assistant is on, the newest tenant, and the assistant's reply to a "hi" sent through the
public web chat of the seeded tenant (`DEMO_CHAT_SLUG`, derived from `SEED_TENANT_NAME`).

Web chat lives at `https://<domain>/chat/<tenant-slug>` for every tenant and needs no WhatsApp
number; payment links point at `https://<domain>/pay/<intent>` (`PUBLIC_BASE_URL`, set by the
workflow). Payments run on the mock provider until a gateway is chosen; see `docs/RUNBOOK.md`.

**Credentials.** The runner logs in with the `VPS_SSH_KEY` secret (a private key) when it is
set and authorized, otherwise with the `VPS_PASSWORD` secret (root password). To move to keys:

```
ssh-keygen -t ed25519 -N "" -f vps_actions -C github-actions-vps
```

Add the contents of `vps_actions` as the repository secret `VPS_SSH_KEY`. The next run still
logs in with the password, authorizes that key on the server, and later runs use the key.

**SSH access for people.** Every run authorizes, for root, the public keys published on the
GitHub accounts of the person who ran it and of the repository owner (`github.com/<user>.keys`),
plus any keys in the `SSH_PUBLIC_KEYS` repository variable (one per line) and the
`ssh_public_key` input. After a run, `ssh root@<server-ip>` works with your usual key.

**Turning off password login.** Once a run has connected with `VPS_SSH_KEY` (the log says
`Connecting with: key`), run the workflow again with `disable_password_auth` ticked. It refuses
to do this from a password-authenticated run, so it cannot lock you out.

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
number, permanent access token) from the Meta app dashboard. Set `SEED_ADMIN_EMAIL` to the
address you will sign in with; `SEED_ADMIN_PASSWORD` was generated, change it if you like.
Leave the other generated values alone.

### 3. Deploy

```
/opt/ordr/deploy/deploy.sh --seed
```

This builds the API and dashboard images, starts the five services, waits for the health
check, applies migrations (the API container does this at startup), and loads the tenant, the
demo menu and the dashboard owner. It ends by printing the dashboard and webhook URLs. Reseeding
(`--seed` again) resets the owner's password to `SEED_ADMIN_PASSWORD`.

Sign in at `https://<DOMAIN>/login`. The orders board polls every few seconds; accepting,
preparing and completing orders there messages the customer on WhatsApp at each step while
their 24 hour service window is open.

Caddy obtains the TLS certificate on first request, so `https://<DOMAIN>/health` may take a few
seconds the first time.

## Onboard a merchant (platform admin)

1. In Meta's WhatsApp Manager, add a phone number to ordr.ae's WhatsApp Business Account and
   verify it (SMS or call to the SIM). Set its display name and profile to the merchant's
   brand. Note its Phone number ID; the WABA ID and the system-user token are the same for
   every number on the account.
2. Dashboard › Admin › Number pool › Add: display number, Phone number ID, WABA ID, token.
3. Admin › New merchant: name, vertical, owner name and email, pick the number, keep "load the
   demo catalog" ticked for a first demo. Copy the one-time password shown and send it to the
   owner privately.
4. The owner signs in at https://app.ordr.ae/login, edits the catalog and team, and customers
   can message the number right away. Templates: Settings › WhatsApp templates › Submit once.

The webhook below is registered once for the whole account; every number on it delivers to it.

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
| Tail logs | `docker compose logs -f api worker dashboard` |
| Stuck notifications | `docker compose exec postgres psql -U ordr ordr -c "select status, count(*) from \"OutboxEvent\" group by 1"` |
| Service status | `docker compose ps` |
| Restart the API only | `docker compose restart api` |
| Change configuration | edit `.env`, then `docker compose up -d` |
| Back up now | `./backup.sh` (nightly at 03:00 via `/etc/cron.d/ordr-backup`) |
| Restore | `docker compose exec -T postgres pg_restore -U ordr -d ordr --clean --if-exists < ../backups/ordr-<stamp>.dump` |
| Open a psql shell | `docker compose exec postgres psql -U ordr ordr` |
| Reseed demo data | `./deploy.sh --no-pull --seed` |
| Switch the demo tenant to the salon | set `SEED_BLUEPRINT_ID=salon` and `SEED_TENANT_NAME="Demo Salon"` in `.env`, then `./deploy.sh --no-pull --seed` |
| Check the assistant is on | `docker compose logs api | grep "AI assistant"` |

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
- The same API image runs twice: once as the API (migrations, HTTP) and once as the worker
  (`SKIP_MIGRATIONS=1`, no HTTP). Events the API writes to the `OutboxEvent` table are picked
  up by the worker within a second; a failed WhatsApp send is retried with backoff up to 12
  times and then parked as `failed`.
- `apps/dashboard/Dockerfile` builds the Next.js dashboard as a standalone server on port 3001.
- `deploy/compose.yml` wires the services. Postgres and Redis are reachable only on the Docker
  network. `DATABASE_URL` and `REDIS_URL` are set there, not in `.env`.
- `deploy/caddy/Caddyfile` serves `DOMAIN` with automatic certificates: API paths to port 3000,
  everything else to the dashboard on 3001.

## Growing out of it

The box is a single point of failure. When that matters, move Postgres to a managed instance
(point `DATABASE_URL` in `compose.yml` at it and drop the postgres service) before moving anything
else. The worker and dashboard apps from the roadmap can join this compose file as extra services.
