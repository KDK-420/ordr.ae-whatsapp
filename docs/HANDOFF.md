# Handoff: state of the build as of 2026-10-19 (round 4)

Read docs/PLAN.md first for the architecture and roadmap, docs/DEPLOY.md for the server. This
note says where the build is and what to do next.

## What exists (all green: 58 package tests, 72 API tests, 13 Postgres integration tests)

### Deployed

Production runs on one VPS (200.141.6.31) at https://app.ordr.ae, deployed by the `VPS`
GitHub Actions workflow (Actions tab, Run workflow; `deploy` mode for updates). Six containers:
Postgres, Redis, API, worker, dashboard, Caddy. Caddy routes `/health`, `/webhooks/*` and
`/merchant/*` to the API and everything else to the dashboard. SSH is key-only; the workflow
logs in with the `VPS_SSH_KEY` secret.

### Round 4 (this round): salon bookings and the Claude assistant

- **Scheduling domain** (`packages/domain/src/scheduling.ts`): weekly opening hours per
  resource, timezone helpers (tenants run in `Asia/Dubai` by default), `generateSlots` with
  step, service duration, buffer between appointments and lead time, overlap checks.
- **Resources** (staff, rooms, assets) with hours, skills (offering ids they can serve) and sort
  order; `Resource` table, `ResourceRepository` (memory and Prisma). Bookings are Orders with
  `kind: "booking"`, `scheduledAt`, `resourceId`, `durationMinutes`; `createBooking` locks the
  resource row and rechecks overlaps inside the transaction, so two customers cannot take the
  same slot (migration `20261016100000_resources_bookings`).
- **SchedulingService** (`apps/api/src/scheduling`): services, staff per service, days with
  availability, slots by part of day, book with "anyone available" (first free person by sort
  order), upcoming, cancel. Settings come from the blueprint and can be overridden per tenant
  in `tenant.settings` (`slotStepMinutes`, `bufferMinutes`, `leadMinutes`, `maxAdvanceDays`).
- **Salon blueprint** (`packages/blueprints/src/salon`): main menu, `book_service` (service →
  staff → day → part of day → time → confirm, with a clean recovery when the slot is taken
  meanwhile), `my_bookings` (list and cancel), plus the shared talk-to-us and language flows,
  in English and Arabic. Booking status notifications use booking wording with the appointment
  time. `SEED_BLUEPRINT_ID=salon` seeds the demo salon (two stylists, five services) in memory
  mode and through `prisma/seed.ts`.
- **Claude assistant** (`apps/api/src/ai`, ADR-002 in the plan): on by itself when
  `ANTHROPIC_API_KEY` is set, off otherwise with identical flow behaviour. Three jobs, all
  through `@anthropic-ai/sdk` with structured JSON output, low effort and server-side refusal
  fallbacks: (1) free text that no command or flow understood is interpreted against the
  tenant's services, staff, flow descriptions and `tenant.settings.facts`, and either starts the
  right flow or answers a factual question; (2) a typed answer the current question does not
  accept is mapped onto one of the buttons or rows actually shown (`FlowRunner.pendingOptions`),
  so "the hair cut one" selects Haircut; (3) `POST /merchant/conversations/:id/draft` and the
  "Draft with AI" button in the inbox propose a reply for an agent to edit. The model never
  writes to the database and never states prices or times the flow will not confirm; every
  model failure degrades to the menu. `ScriptedAssistant` in `test/salon.e2e.test.ts` shows how
  to test flows that lean on it; `src/ai/anthropic.assistant.test.ts` pins the request shape.

- **Natural conversation style** (`apps/api/src/ai/agent.ts`, `anthropic.agent.ts`). Per tenant,
  `settings.conversationStyle` is `natural` or `guided` (blueprint default: salon natural,
  restaurant guided; owners switch it under Settings › Conversation, where they also keep the
  `facts` the bot may share). In natural style every customer message goes to Claude through
  the SDK tool runner with tools bound to the tenant and customer: list_services, list_staff,
  available_days, available_times, book_appointment, my_bookings, cancel_booking,
  hand_over_to_human, and open_ordering_menu for non-salon verticals (it sends the guided menu
  after the reply). The system prompt carries the business facts, today's date and the next
  week's dates in the tenant timezone, and WhatsApp-style rules (short, no markdown, confirm
  once, book immediately on a yes). The model never writes data itself: bookings go through
  `SchedulingService.book`, which re-checks the slot. A tapped button from an older guided
  message still resumes its flow; a model failure falls back to the guided menu; a handoff
  pauses the bot until the inbox hands it back. Without `ANTHROPIC_API_KEY` the tenant runs
  guided. Tests: `src/ai/anthropic.agent.test.ts` (scripted API, real scheduling engine) and
  `test/natural.e2e.test.ts` (scripted agent through ConversationService).
- **Salon dashboard.** `GET /merchant/bookings?from&to` and `/merchant/resources` (owner-only
  writes); Calendar (day view per team member, off-hours shaded, booking drawer with the
  blueprint's transitions), Settings › Team and hours, kind and duration on catalog items, and
  an orders board whose columns come from the state machine for non-restaurant blueprints.
  `/merchant/me` returns the blueprint's `dashboardModules`; the nav shows Calendar only when
  the module is listed.
- **Appointment reminders.** `OrderService.placeBooking` queues one `booking.reminder` outbox
  event per lead time (`reminderMinutes` in the blueprint or tenant settings, salon default
  `[1440, 120]`) with `nextAttemptAt` set ahead of the appointment (`OutboxStore.schedule`).
  The worker's relay delivers them when due to `BookingReminderNotifier`, which re-reads the
  booking (cancelled, finished or moved bookings get nothing) and sends text inside the 24h
  window or the `ordr_booking_reminder` template outside it. In memory mode nothing relays the
  outbox, so reminders only go out through the worker on Postgres.
- **Merchant onboarding (platform admin).** `User.isPlatformAdmin` (the seeded owner has it)
  unlocks `/admin` in the dashboard and the `/admin/*` API: a pool of WhatsApp numbers the
  platform owns (`PhoneNumber` table; the access token never leaves the API), "New merchant"
  (tenant + owner with a one-time password + optional demo catalog and salon staff with fresh
  ids + a number from the pool), assign / move / release numbers, reset an owner's password.
  Assigning a number upserts the tenant's `Channel` by `phoneNumberId`, so routing follows the
  number; releasing sets the channel `disabled` and keeps the history. This is "Option A":
  merchants never touch Meta; numbers are verified once in ordr.ae's own WhatsApp account and
  their display name and profile are set per number in WhatsApp Manager.
- **Demo page** (`/demo` in the dashboard, `apps/api/src/simulator`): a WhatsApp-styled phone
  where you add a demo customer (synthetic wa id starting with `000`) and chat with the real
  bot: buttons, list sheets and location requests are tappable, agent replies from the Inbox
  show up, "Restart" forgets the flow. `DemoAwareSender` wraps the real sender so demo numbers
  never reach Meta; everything else (bookings, orders, inbox, assistant) is the production path.

### Round 3

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
5. Onboarding, next: Embedded Signup for merchants who want their own WhatsApp account
   (needs Meta app review and Tech Provider status); self-serve signup page; a "sign in as"
   for platform admins; tenant deactivation.
6. Analytics on the dashboard (orders per day, revenue, top items) and order history search.
7. WhatsApp Flows node type (`form`) in the schema and runner, needed for the salon date picker
   in Phase 2.
8. Salon, remaining: rescheduling from WhatsApp and the calendar (today a move is cancel and
   rebook), a week view, per-resource breaks and days off, and the WhatsApp Flows date picker.
9. Natural style, next: rescheduling as a tool (today it hands over), restaurant ordering as
   tools (cart, modifiers, delivery address) instead of opening the guided menu, voice notes
   (transcribe then treat as text), per-conversation token cost in the logs, and an eval set of
   real transcripts to tune the prompt.

## Open decisions still waiting on the owner

Payment providers, merchant pricing model, delivery logistics partner, launch languages beyond
en and ar. See docs/PLAN.md section 14. Hosting is decided for the pilot: one VPS; move Postgres
to a managed instance first when that stops being enough.
