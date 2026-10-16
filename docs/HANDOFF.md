# Handoff: state of the build as of 2026-10-16

Read docs/PLAN.md first for the architecture and roadmap, docs/DEPLOY.md for the server. This
note says where the build is and what to do next.

## What exists (all tests green: 42 unit, 7 integration, 10 API e2e)

### Deployed

Production runs on one VPS (200.141.6.31) at https://app.ordr.ae, deployed by the `VPS`
GitHub Actions workflow (Actions tab, Run workflow). Caddy serves TLS and routes `/health`,
`/webhooks/*` and `/merchant/*` to the API and everything else to the dashboard. SSH is key-only;
the workflow logs in with the `VPS_SSH_KEY` secret.

### Merchant dashboard and API (Phase 2a, this round)

- `apps/dashboard` (Next.js 16, Tailwind 4, standalone output): landing page at `/`, sign-in
  at `/login`, orders board at `/orders` with columns New / In progress / Ready / Done (24 h),
  an order detail drawer, and action buttons driven by the blueprint state machine. Polls the
  API every 8 seconds. `proxy.ts` redirects by the presence of the session cookie.
- Merchant API in `apps/api/src/auth` and `src/merchant`:
  `POST /merchant/auth/login` (sets an httpOnly `ordr_session` cookie and returns the token),
  `POST /merchant/auth/logout`, `GET /merchant/me`, `GET /merchant/orders?scope=board|active|all`,
  `GET /merchant/orders/:id`, `POST /merchant/orders/:id/transition { event }`.
  Orders come back with the customer (name, WhatsApp id), `allowedEvents` from the blueprint
  and `isTerminal`. Invalid transitions are 409, unknown orders 404.
- Auth: `User` table (migration `20261016060000_users`), scrypt password hashes
  (`src/auth/password.ts`), HMAC-SHA256 session tokens signed with `AUTH_SECRET`
  (`src/auth/token.ts`), `AuthGuard` reads a Bearer header or the cookie. The seed creates an
  owner from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; memory mode does the same at startup.
- Order status notifications (`src/orders/order-notifier.ts`): subscribes to
  `order.status_changed` and sends the customer a localized text while their 24 hour window is
  open (checked against `Conversation.lastInboundAt`). Outside the window it logs and skips;
  template messages are not implemented yet. The final `delivered -> completed` step is silent.
- `GET /` on the API returns a small HTML page instead of a 404.

### Phase 1 (catalog and checkout)

- Catalog tables (Category, Offering, ModifierGroup, ModifierOption) and Order tables (Order,
  OrderItem, OrderEvent). Money is stored in minor units.
- Domain cart: addItem merges identical lines, quote handles delivery fee and inclusive or
  exclusive VAT (packages/domain/src/cart.ts, money.ts, catalog.ts).
- Restaurant flows: order_food (categories, items, modifier loop, quantity), checkout (delivery
  with location and address note, or pickup; quote; confirm), view_cart (global command "cart"),
  track_order. Copy in en and ar.
- Action layer in apps/api/src/actions: catalog.*, cart.*, orders.* bound to repositories and
  OrderService. The demo menu in demo-catalog.ts feeds both the in-memory catalog and the seed.
- OrderService: quote, place (sequential per-tenant numbers, "order.placed" event), transition
  (blueprint state machine, "order.status_changed" event) over an in-process EventBus port.

### Phase 0 inventory

| Workspace | Purpose |
|-----------|---------|
| packages/domain | Tenant, Channel, Customer, Order types; blueprint-driven state machine helpers |
| packages/whatsapp | Cloud API webhook types and parser, HMAC signature check, outbound builders that enforce Meta limits, HTTP client, FakeSender and LoggingSender, webhook fixtures |
| packages/flow-schema | zod schemas for flows and blueprints, FlowRunner, localized copy, interpolation, Arabic detection |
| packages/blueprints | Restaurant blueprint: main_menu, order_food, checkout, view_cart, track_order, talk_to_us, language flows in en and ar |
| apps/api | NestJS app: webhook controller, InboundQueue (serial per customer), ConversationService, merchant API, memory/Redis/Prisma adapters, Prisma schema, seed, simulator CLI |
| apps/dashboard | Next.js merchant dashboard |

Commands from the repo root:

```
pnpm install
pnpm build && pnpm typecheck && pnpm test   # full pipeline, also what CI runs
pnpm simulate                               # chat with the bot in the terminal, no WhatsApp needed
pnpm db:up && pnpm db:migrate && pnpm db:seed   # Postgres + Redis via Docker, then schema and demo tenant
pnpm dev                                    # API with tsx watch; needs .env (copy .env.example)
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
  grows, both adapters grow with it.
- Blueprints are JSON validated by packages/flow-schema. The order state machine in the
  blueprint is the single source of truth for which buttons the dashboard shows.
- Actions are named handlers registered in a MapActionRegistry. The demo catalog actions live in
  apps/api/src/actions/demo-catalog.ts and are the only place with hard-coded menu data.
- Outbound builders throw on Meta limit violations; dynamic data is clipped in the runner.
- The dashboard talks to the API on the same origin (`/merchant/*`) so the session cookie
  travels without CORS. Keep new dashboard endpoints under that prefix.

## Next steps, in order

1. Connect the real WhatsApp number: real `META_APP_SECRET` and `SEED_*` values on the server,
   a fresh `META_VERIFY_TOKEN`, register the webhook in the Meta dashboard, send "hi".
2. Template messages for notifications outside the 24 hour window: a per-tenant template
   registry, Meta template submission, and `OrderNotifier` falling back to a template.
3. Dashboard: inbox (conversations and messages already stored; agent replies must respect the
   human/bot conversation status), catalog editing, staff management (invite, reset password),
   and a change-password page. Users are owner or staff; no permissions differ yet.
4. Persist the event outbox: write DomainEvents to a table in the same transaction and relay from
   a worker (apps/worker, BullMQ) instead of the in-process InMemoryEventBus. Notifications then
   survive restarts and retries.
5. Payment links behind a PaymentProvider port (Stripe UAE, Telr, Ziina); today paymentMethod is
   always "cash".
6. Multi-select modifier groups, item notes, scheduled orders, delivery zones with per-zone fees.
7. WhatsApp Flows node type (`form`) in the schema and runner, needed for the salon date picker
   in Phase 2.

## Open decisions still waiting on the owner

Payment providers, merchant pricing model, delivery logistics partner, launch languages beyond
en and ar. See docs/PLAN.md section 14. Hosting is decided for the pilot: one VPS; move Postgres
to a managed instance first when that stops being enough.
