# Runbook: conversational commerce and booking platform

What is real, what is mocked, how to run it, and how to verify it. Companion to
`docs/IMPLEMENTATION_PLAN.md` and the ADRs in `docs/ADRs/`.

## Run locally

```bash
pnpm install
pnpm build                       # packages first; the API resolves them from dist
# API in memory mode (no Postgres), retail demo tenant, slug "seed"
cd apps/api && STORAGE=memory SEED_BLUEPRINT_ID=retail SEED_TENANT_NAME="Demo Shop" \
  ANTHROPIC_API_KEY=sk-ant-... pnpm exec tsx src/main.ts
# Dashboard + public pages on :3001 (rewrites /merchant/* and /v1/* to the API)
cd apps/dashboard && pnpm dev
```

Open http://localhost:3001/chat/seed. `SEED_BLUEPRINT_ID=salon` gives the booking demo instead.
Without `ANTHROPIC_API_KEY` the agent is off and web chat falls back to the guided flow (for
retail that is a "team will reply" handoff), which is the documented degraded mode.

With Postgres: set `DATABASE_URL`, run `pnpm exec prisma migrate deploy` and `pnpm exec prisma db seed`
in `apps/api`, start the API (`tsx src/main.ts`) and the worker (`tsx src/worker.ts`).

## Verify

| Check | Command |
| --- | --- |
| Package tests | `pnpm -r --filter './packages/*' test` |
| API unit + e2e (in memory) | `pnpm --filter @ordr/api test` |
| Postgres integration (row locks, holds, stock, isolation) | `DATABASE_URL=... pnpm --filter @ordr/api test:integration` |
| Typecheck everything | `pnpm typecheck` |

The acceptance list from the PRD maps to: `test/webchat.e2e.test.ts` (anonymous sessions,
idempotent client message ids, tenant isolation, memory consent and withdrawal, memory off,
handoff), `test/commerce.e2e.test.ts` (live pricing, stock reservation, signed webhooks, replay,
amount mismatch, failed and expired payments releasing stock), `src/ai/anthropic.agent.test.ts`
(hold → confirm, stale and foreign holds, commerce tools, memory tools with the sensitive-data
deny list) and `test/integration/commerce-holds.test.ts` (concurrent holds under the resource
lock, conditional stock decrements, tenant scoping of every new table).

## Public endpoints (no merchant login)

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/chat/sessions` `{slug, name?, language?}` | Anonymous session for the tenant behind `slug`; returns `token` once |
| `GET /v1/chat/sessions/:id` (Bearer token) | Thread and status (`bot` or `human`) |
| `POST /v1/chat/sessions/:id/messages` `{text, clientMessageId?}` | Sends a message, returns the thread with the reply |
| `GET /v1/pay/:intent` | Checkout page data (amount, items, state) |
| `POST /v1/pay/:intent/simulate` `{outcome?: "fail"}` | Mock provider only: produces the signed webhook |
| `POST /v1/webhooks/payments/:provider` | Provider webhook, verified from the raw body |

Pages: `/chat/<tenant-slug>` (web chat), `/pay/<intent>` (hosted checkout).

## What is mocked and how to replace it

- **Payments.** `MockPaymentProvider` (`apps/api/src/payments/payment-provider.ts`) implements
  the `PaymentProvider` port: `createCheckout` returns a page in this app, `verifyWebhook`
  checks an HMAC-SHA256 over the raw body with `PAYMENT_WEBHOOK_SECRET`. A real adapter
  (Stripe, Telr, Ziina) implements the same two methods and is selected with
  `PAYMENT_PROVIDER`; `CommerceService` and the webhook controller do not change. Orders become
  `paid` only through `applyPaymentEvent`, which dedupes on the provider's event id
  (`WebhookReceipt`) and refuses amounts that differ from the intent.
- **Model.** The agent is Claude through the official SDK (`AnthropicAgent`). Tests use a
  scripted fake that speaks the same wire format (`fakeApi` in the agent test) or a
  `ScriptedAgent` implementing `ConversationAgent`.
- **WhatsApp.** Real adapter; `WHATSAPP_SENDER=log` prints instead of sending. Web chat
  customers (`web:` ids) and demo customers (`000` ids) never reach Meta.
- **Identity linking.** Web visitors are anonymous (`web:<random>` per session). Linking a web
  visitor to a verified WhatsApp identity is Phase 2 (OTP); until then memories consented in
  web chat belong to that anonymous identity only.
- **Housekeeping.** Expired holds and unpaid checkouts are released by `MaintenanceService`
  (worker process on Postgres; the API itself in memory mode), every minute.

## Configuration added this round

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:3001` | Where customers reach the web pages; used in payment links |
| `PAYMENT_PROVIDER` | `mock` | Payment adapter |
| `PAYMENT_WEBHOOK_SECRET` | falls back to `AUTH_SECRET`, then `META_APP_SECRET` | Signs and verifies payment webhooks |
| `HOLD_MINUTES` | 10 | How long a held slot stays reserved |
| `CHECKOUT_MINUTES` | 30 | How long a payment link stays valid and stock stays reserved |
| `MEMORY_RETENTION_DAYS` | 365 | Expiry of remembered preferences |
| `DEMO_CHAT_SLUG` (dashboard) | empty | Tenant slug behind the landing page's "Try the demo in web chat" button |

Per tenant, in `tenant.settings`: `memoryEnabled` (default true; false disables memory tools
and recall), `conversationStyle` (`natural` or `guided`), `facts`.

## Data model additions (migration `20261020090000_commerce_holds_memory_webchat`)

`ProductVariant`, `Offering.stock`, `Cart`, `PaymentIntent`, `WebhookReceipt`, `BookingHold`,
`WebSession` (token stored hashed), `CustomerConsent`, `Memory` (soft delete, expiry, source
message ids), `AgentRun` (tools, memory ids, tokens, duration, outcome). `Channel.provider`
gains `web` for the per-tenant virtual web channel.

## Known limits

- One API instance: the per-customer inbound queue is in process. Behind a load balancer, move
  it to BullMQ (the `InboundQueue` interface is the seam).
- Memory extraction is model-driven through the `remember` tool, gated by consent and a deny
  list for sensitive categories. There is no background extraction pass yet.
- Web chat polls only while a person has taken over; everything else is request/response.
- The retail guided fallback is a plain handoff; the vertical is meant to run in the natural
  style.
