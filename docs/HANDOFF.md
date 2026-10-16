# Handoff: state of the build as of 2026-10-16 (round 3)

Read docs/PLAN.md first for the architecture and roadmap, docs/DEPLOY.md for the server. This
note says where the build is and what to do next.

## What exists (all green: 45 package tests, 46 API tests, 10 Postgres integration tests)

### Deployed

Production runs on one VPS (200.141.6.31) at https://app.ordr.ae, deployed by the `VPS`
GitHub Actions workflow (Actions tab, Run workflow; `deploy` mode for updates). Six containers:
Postgres, Redis, API, worker, dashboard, Caddy. Caddy routes `/health`, `/webhooks/*` and
`/merchant/*` to the API and everything else to the dashboard. SSH is key-only; the workflow
logs in with the `VPS_SSH_KEY` secret.

### Round 3 (this round)

- **Transactional outbox and worker.** Order changes write their domain event to `OutboxEvent`
  in the same Postgres transaction (`OrderRepository.create/updateStatus` take an outbox
  factory). The API process's `EventBus` is `OutboxEventBus` (write only). The worker
  (`apps/api/src/worker.ts`, same image, `role: "worker"`) runs `OutboxRelay`: claims due rows
  with `FOR UPDATE SKIP LOCKED`, dispatches them to handlers on an in-process bus, retries with
  exponential backoff (2s doubling, 5 min cap) and parks events as `failed` after
  `OUTBOX_MAX_ATTEMPTS` (12). Claims older than 5 minutes are requeued. In memory mode events
  are still handled in process, so tests and the simulator behave as before.
- **WhatsApp templates.** `MessageTemplate` table per tenant. `TemplateService.submitDefaults`
  registers `ordr_order_status` in every blueprint language (en, ar) through
  `CloudApiClient.createTemplate`; `sync` pulls review statuses. `OrderNotifier` sends plain
  text inside the 24 hour window and the approved template outside it; with nothing approved it
  logs and skips. `FakeTemplateApi` (used whenever `WHATSAPP_SENDER` is not `meta`) approves
  instantly. Dashboard: Settings › WhatsApp templates. Meta's `message_template_status_update`
  webhook is not parsed yet; the sync button covers it.
- **Inbox.** `GET /merchant/conversations`, `GET /merchant/conversations/:id` (thread),
  `POST .../messages` (agent reply, only inside the window, flips the conversation to `human`
  so the bot stays quiet until the customer asks for the menu), `POST .../status`
  (bot/human/closed). Dashboard `/inbox`: list, thread, reply, take over / hand back / close.
- **Catalog editing.** `GET /merchant/catalog`, `POST/PATCH /merchant/catalog/categories`,
  `POST/PATCH /merchant/catalog/offerings` (modifier groups replaced wholesale on PATCH).
  Items and categories are archived with `isActive: false`, never deleted, because orders keep
  references. Dashboard `/catalog`: categories sidebar, items table, drawer with bilingual
  fields, price, category, modifier groups and options.
- **Staff.** Owners: `GET/POST /merchant/users`, `PATCH /merchant/users/:id`,
  `POST /merchant/users/:id/reset-password` (temporary password shown once). Everyone:
  `POST /merchant/me/password`. Dashboard: Settings › Staff and Settings › Your password.

### Round 2 (merchant dashboard and API)

- `apps/dashboard` (Next.js 16, Tailwind 4, standalone output): landing page, `/login`,
  `/orders` board with action buttons driven by the blueprint state machine, polling.
  `proxy.ts` redirects by the presence of the session cookie.
- Merchant auth: `User` table, scrypt hashes, HMAC-SHA256 session tokens (`AUTH_SECRET`),
  `AuthGuard` reads a Bearer header or the `ordr_session` cookie. Seed creates an owner from
  `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- Orders API: `GET /merchant/orders?scope=board|active|all`, `GET /merchant/orders/:id`,
  `POST /merchant/orders/:id/transition { event }`.

### Round 1 and 0

Catalog, cart, checkout and order flows in en and ar; OrderService with per-tenant numbers and
the blueprint state machine; WhatsApp Cloud API adapter with signature verification; flow
engine; restaurant blueprint; memory, Redis and Prisma adapters; simulator CLI.

| Workspace | Purpose |
|-----------|---------|
| packages/domain | Tenant, Channel, Customer, Order and catalog types; state machine helpers |
| packages/whatsapp | Cloud API client (messages, templates), webhook parsing, signature check, builders, FakeSender |
| packages/flow-schema | zod schemas for flows and blueprints, FlowRunner, localized copy |
| packages/blueprints | Restaurant blueprint and flows in en and ar |
| apps/api | NestJS API and worker: webhook, conversation engine, orders, merchant API, outbox relay |
| apps/dashboard | Next.js landing page and merchant dashboard |

Commands from the repo root:

```
pnpm install
pnpm build && pnpm typecheck && pnpm test   # full pipeline, also what CI runs
pnpm simulate                               # chat with the bot in the terminal, no WhatsApp needed
pnpm db:up && pnpm db:migrate && pnpm db:seed   # Postgres + Redis via Docker, then schema and demo tenant
pnpm --filter @ordr/api test:integration    # Postgres suites (adapters, catalog/orders, outbox/templates)
pnpm dev                                    # API with tsx watch; needs .env (copy .env.example)
pnpm --filter @ordr/api exec tsx src/worker.ts   # worker against the same .env
pnpm --filter @ordr/dashboard dev           # dashboard on http://localhost:3001, proxies /merchant/* to :3000
```

For a local dashboard login without Postgres, start the API with `STORAGE=memory`,
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` set.

## Design rules to keep

- Every constructor dependency in apps/api uses an explicit @Inject token from src/tokens.ts.
  Vitest runs through esbuild, which does not emit decorator metadata, so implicit injection
  by type will fail at runtime in tests.
- Adapters implement the interfaces in apps/api/src/ports.ts. Tests and the simulator use the
  in-memory ones; production picks Prisma plus Redis from config in app.module.ts. When a port
  grows, both adapters grow with it, and the Postgres one gets an integration test.
- Anything that must survive a crash goes through the outbox: build the `DomainEvent` with a
  fixed id, hand the factory to the repository so the row is written in the same transaction,
  then publish the same event. Handlers that fail should throw so the relay retries them;
  handlers that decide to skip should return normally.
- Blueprints are JSON validated by packages/flow-schema. The order state machine in the
  blueprint is the single source of truth for which buttons the dashboard shows.
- The dashboard talks to the API on the same origin (`/merchant/*`) so the session cookie
  travels without CORS. Keep new dashboard endpoints under that prefix, validate bodies with
  zod in the controller, and keep owner-only routes behind `requireOwner`.
- Outbound builders throw on Meta limit violations; dynamic data is clipped in the runner.

## Next steps, in order

1. Connect the real WhatsApp number: real `META_APP_SECRET` and `SEED_*` values on the server,
   a fresh `META_VERIFY_TOKEN`, register the webhook in the Meta dashboard, send "hi", then
   Settings › WhatsApp templates › Submit, and wait for approval.
2. Parse Meta's `message_template_status_update` webhook so template statuses update without
   the sync button, and surface `failed` outbox events in the dashboard.
3. Payment links behind a PaymentProvider port (Stripe UAE, Telr, Ziina); today paymentMethod is
   always "cash".
4. Multi-select modifier groups in the ordering flow (the catalog editor already stores
   maxSelect > 1), item notes, scheduled orders, delivery zones with per-zone fees.
5. Onboarding: Embedded Signup and tenant creation from the dashboard instead of the seed;
   super-admin console.
6. Analytics on the dashboard (orders per day, revenue, top items) and order history search.
7. WhatsApp Flows node type (`form`) in the schema and runner, needed for the salon date picker
   in Phase 2.

## Open decisions still waiting on the owner

Payment providers, merchant pricing model, delivery logistics partner, launch languages beyond
en and ar. See docs/PLAN.md section 14. Hosting is decided for the pilot: one VPS; move Postgres
to a managed instance first when that stops being enough.
