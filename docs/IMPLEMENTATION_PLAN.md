# Implementation plan: Conversational Commerce & Booking AI Platform

Source: `docs/PRD/CLAUDE_CODE_PRD.md` (v1.0, 20 Oct 2026). This file is the living checklist.
Decisions are recorded in `docs/ADRs/`. What is mocked and what needs credentials is in
`docs/RUNBOOK.md`.

## Starting point (inspected 20 Oct 2026)

The repository already had, tested and deployed at https://app.ordr.ae:

- pnpm + Turborepo monorepo, NestJS (Express) API, Prisma + PostgreSQL, Redis, Next.js dashboard.
- Multi-tenant data model (`tenantId` on every row), owner/staff roles, platform admin, tenant
  creation and a WhatsApp number pool.
- Booking engine: resources with weekly hours and skills, slot generation (step, duration,
  buffer, lead time, timezone), row-locked overlap check, reminders through a transactional
  outbox and worker.
- Catalog with categories, offerings (products and services) and modifier groups; orders with a
  per-vertical state machine.
- WhatsApp Cloud API adapter: signature verification, webhook normalization, dedupe on provider
  message id, outbound delivery, message status tracking, templates.
- One tool-calling agent (Claude through the official SDK) for the "natural" conversation style,
  tools bound to tenant and customer; guided JSON flows kept as a fallback.
- Dashboard: inbox with takeover, orders board, calendar, catalog, team, settings, demo
  simulator, admin console; public marketing site.

Preserved as is. The guided flows stay as a fallback and for tenants that opt in; they are not
the conversational experience.

## Phase 0, foundations

- [x] Monorepo, env validation (zod), typecheck, tests, Docker Compose for Postgres + Redis
- [x] Auth, RBAC (owner, staff, platform admin), tenant isolation in every repository
- [x] Health checks, outbox, worker
- [x] ADRs for the choices the PRD leaves open (`docs/ADRs`)
- [ ] OpenAPI document for the public chat API (Phase 3)

## Phase 1, functional vertical slice (this round)

- [x] Seeded salon tenant and seeded retail tenant (`SEED_BLUEPRINT_ID=salon|retail`, admin
      "New merchant" with demo data)
- [x] Web chat API: anonymous sessions, messages in and out with real persistence
      (`POST /v1/chat/sessions`, `POST /v1/chat/sessions/:id/messages`, `GET .../messages`)
- [x] Web chat UI (`/chat/<tenant-slug>`), mobile first, text always usable
- [x] Agent provider abstraction (`ConversationAgent` port, Anthropic implementation, scripted
      fake for tests)
- [x] Read-only tools: services, staff, availability, products (search, detail, stock)
- [x] Booking: hold → confirm with explicit customer confirmation, reschedule, cancel; holds
      expire; overlap check covers holds and bookings under a resource row lock
- [x] Commerce: variants with stock, persistent cart per customer, checkout creates a payment
      intent and reserves stock, order becomes paid only on a verified provider webhook
- [x] Mock payment provider: hosted page `/pay/<intent>` that posts a signed webhook; replay safe
- [x] Agent runs recorded (tools called, tokens, duration) per reply
- [x] Idempotent inbound on both channels (provider message id / client message id)

## Phase 2, memory

- [x] Consent per customer (on/off, purpose), memory on/off per tenant
- [x] Structured preferences and episodic facts with source message ids, confidence, expiry
- [x] Tools: `record_memory_consent`, `remember`, `forget`, `what_you_remember`
- [x] Retrieval: consented, unexpired, tenant- and customer-scoped facts in the prompt, with the
      used memory ids in the agent run trace
- [x] Transaction history from source of truth (bookings, orders) injected separately
- [ ] Session summaries for long threads (today: last N turns)
- [ ] Anonymous web → verified WhatsApp identity linking by OTP

## Phase 3, business ops

- [x] Inbox with takeover and release, AI stops immediately
- [x] Calendar, orders board, catalog, team, settings, admin console
- [ ] Customer page with timeline and memory controls (view, correct, delete)
- [ ] Agent run viewer (trace per reply)
- [ ] Knowledge documents with retrieval (today: tenant `facts`)
- [ ] Analytics funnel per tenant

## Phase 4, messaging and payment

- [x] WhatsApp Cloud adapter with signature verification, retries, 24h window, templates
- [ ] Instagram adapter
- [ ] Production payment adapter (Stripe or a UAE gateway) behind the same `PaymentProvider` port
- [x] Outbox retries with dead-letter ("failed") state

## Phase 5, hardening

- [x] Concurrency test: last slot, two bookers, one wins (Postgres integration test)
- [x] Replayed payment webhook: single transition
- [x] Replayed inbound: no duplicate reply
- [x] Cross-tenant negative tests on the chat and merchant APIs
- [ ] Load test, security review, observability (OpenTelemetry), model regression evals

## Acceptance tests (PRD §15) → where they live

| # | Test | Status |
|---|------|--------|
| 1 | New customer books a real slot in natural chat; appears in admin | `test/webchat.e2e.test.ts` |
| 2 | Occupied slot → unavailable, real alternatives | `src/ai/anthropic.agent.test.ts` |
| 3 | Concurrent last slot: at most one succeeds | `test/integration/bookings.test.ts` |
| 4 | Returning opted-in customer, "same as last time" | `test/webchat.e2e.test.ts` (memory) |
| 5 | "Forget my preferred stylist" removes memory | `test/webchat.e2e.test.ts` (memory) |
| 6 | Anonymous web user cannot read another customer's orders | `test/webchat.e2e.test.ts` |
| 7 | Web → WhatsApp identity linking | Phase 2, open |
| 8 | Stock changes during conversation, checkout revalidates | `test/commerce.e2e.test.ts` |
| 9 | Replayed payment webhook: one transition | `test/commerce.e2e.test.ts` |
| 10 | Replayed inbound webhook: no duplicate reply | `test/webhook.e2e.test.ts`, `test/webchat.e2e.test.ts` |
| 11 | Human takes over, AI stops | `test/natural.e2e.test.ts` |
| 12 | Tenant A token cannot touch tenant B | `test/isolation.e2e.test.ts` |
| 13 | Prompt injection in knowledge | prompt rules; eval set open |
| 14 | Booking + order in one conversation | `src/ai/anthropic.agent.test.ts` |
| 15 | Provider failure → safe explanation, no fabricated confirmation | `src/ai/anthropic.agent.test.ts` |
| 16 | Memory off: chat works, nothing persisted | `test/webchat.e2e.test.ts` |
| 17 | Timezone and DST handling | `packages/domain/src/scheduling.test.ts` |
| 18 | Fake adapters without credentials; real ones fail clearly | mock payments, log sender, Noop agent |
