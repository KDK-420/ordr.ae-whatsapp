# Conversational Commerce & Booking AI Platform
## Product Requirements + Technical Architecture + Claude Code Build Specification
Version 1.0 | 20 October 2026 | Status: Implementation blueprint

## 0. Mission for Claude Code
Build a production-oriented multi-tenant SaaS that lets customers converse naturally on WhatsApp and a web chat to discover products, buy items, book appointments/resources, modify orders/bookings and obtain support. Do **not** implement scripted decision trees or hardcoded response templates. Use a tool-calling LLM for language understanding and natural responses, while enforcing transactional rules in deterministic backend services. Give the assistant durable customer memory that carries across conversations and channels when identity is verified.

Build a working vertical slice before expanding to channel integrations. All external APIs must have mock adapters for local development. Do not claim integrations are live until tested with real credentials.

## 1. Inspiration and positioning
Public PAIC pages describe WhatsApp/Instagram assistants for inquiries, real-time bookings, shopping, payment links, order tracking and human takeover. We are creating an original platform, not cloning their branding or proprietary implementation. Differentiators: explicit consented customer memory, portable business connectors, transparent traces for actions, multi-tenant infrastructure, configurable policy engine and a unified customer identity.

**North-star:** a returning customer should not need to repeat details the system is permitted to remember and the AI should never invent transactional facts.

### Personas
- Customer: seeks item/service using natural language; may switch from WhatsApp to web.
- Business operator: manages bookings, products, inventory, staff, policies and exception cases.
- Human agent: takes over individual conversations with full context.
- Platform admin: manages tenants, channels, billing, observability and incidents.

## 2. Product scope and priorities
### P0 MVP
1. Business onboarding, role-based access, tenant-scoped configuration, local demo mode.
2. Web chat with natural dialogue, streaming response and handoff state.
3. WhatsApp Cloud API adapter with signature verification, inbound webhook normalization and outbound message delivery tracking.
4. Booking engine: services, staff/resources, capacity, timezones, available slots, holds, confirmation, change, cancellation.
5. Commerce engine: catalog, product variants, inventory, cart, totals, payment link creation, orders and order status.
6. Persistent identity-aware customer profiles and memory with consent, correction, expiry and deletion.
7. AI orchestration with structured tools, deterministic action execution and trace logs.
8. Business dashboard for conversations, customer profiles, bookings, orders, basic analytics and human takeover.
9. Business knowledge ingestion for FAQs/policies with retrieval and source freshness.
10. Automated integration/unit/e2e tests and Docker-based local environment.

### P1 after MVP
Instagram messaging, multilingual Arabic/English support, voice note transcription, image/catalog search, proactive reminders with opted-in and channel-compliant notifications, CRM connectors, Stripe or regional payment provider, Shopify/WooCommerce, booking/calendar integrations, knowledge versioning, agent evaluation dashboard.

### P2
Cross-location inventory, predictive replenishment, loyalty, cohort analytics, adaptive recommendations, multi-agent collaboration only if measurements warrant it, enterprise SSO and dedicated deployments.

### Explicit non-goals for MVP
No autonomous refunds, discounts outside configured bounds, credit-card collection in chat, speculative stock or availability, unsupported claims of human approval, scraping private systems or unconsented cross-business customer profiling. No visual flow-builder or template-message journey designer.

## 3. Core user stories
**B1 New booking:** “Can I book a haircut tomorrow after 6?” Agent checks relevant branch/service/staff/availability, asks only genuinely missing details, presents verified times and creates hold, obtains explicit confirmation and commits reservation. Confirmation includes booking ID and timezone.

**B2 Return booking:** “Same therapist and time as last month, next Friday.” Agent recalls *verified and permitted* last therapist and preferred time, checks live availability and clarifies ambiguous Friday/date as needed. Never assumes a reservation already exists.

**B3 Reschedule:** “Move my appointment to Saturday morning.” Find customer-owned booking, verify identity if needed, check slots, atomically reschedule and confirm.

**C1 Product purchase:** “Need a running shoe under AED 400 for flat feet.” Search real catalog, show in-stock eligible products with verified prices and suitable explanations, ask for size/variant, build cart, verify totals, create checkout link, mark paid only after trusted payment webhook.

**C2 Returning shopping:** “Reorder my usual coffee, but two bags.” With consent, identify prior SKU, confirm current price/stock, build cart with two units and request purchase confirmation.

**C3 Multiple intents:** “Book a massage for Friday and add the lavender oil you suggested.” Agent handles two independent tasks, maintains state and summarizes distinct booking/order commitments.

**C4 Interrupted chat:** Customer leaves during checkout and returns days later. Resume from saved cart state if unexpired. Revalidate price, inventory and consent rather than silently ordering.

**H1 Human takeover:** Operator clicks Take over. AI stops sending messages immediately and alerts assigned agent. Operator can return control to AI with a brief handoff summary.

## 4. Conversation UX principles
- Free text is primary. Optional product cards, time chips or links can make verified options easier to select but must never restrict the conversation to scripted buttons.
- The LLM can ask clarifying questions, adapt wording and recover from typos, interruptions and multiple intents.
- Keep messages short and appropriately conversational; identify as an AI when needed.
- Never pretend a booking/order is confirmed before a successful backend transaction.
- Use customer's language when supported. Preserve names and date/time semantics.
- Minimize repeated questions by using permitted durable memory, current chat state and backend records.
- In customer-visible messages explain why a human is needed or why an operation failed.

### Example return dialogue
Customer: “Hey, can I get the same appointment next week?”
Assistant: “Welcome back! Last time you booked a 60-minute massage with Maya on Tuesday at 6 PM. Want the same service and therapist next week?”
Customer: “Yes, but Thursday after 7.”
Assistant: “[Only after checking availability] Maya has 7:30 PM on Thursday 29 October. Shall I reserve that?”
Customer: “Please do.”
Assistant: “[Only after successful booking commit] Confirmed: 29 October at 7:30 PM, booking #... .”
This is illustrative only. Never hardcode the dialogue or dates.

## 5. Technical architecture
### Logical request flow
```text
WhatsApp Cloud API ----> Channel Webhook Gateway ----+
Web Chat UI -----------> Web Chat API ---------------+--> Identity Resolver
                                                        --> Conversation Store
                                                        --> Context Builder
                                                            |-- Active session and summary
                                                            |-- Customer memory (consent gated)
                                                            |-- Tenant policy + knowledge RAG
                                                            |-- Live transactional state
                                                        --> LLM Agent Runtime / Tool Router
                                                            |-- catalog.search / inventory.check
                                                            |-- availability.search / booking.hold / booking.confirm
                                                            |-- cart.update / checkout.create
                                                            |-- orders.lookup / booking.modify
                                                            |-- memory.propose / memory.correct
                                                            |-- handoff.request
                                                        --> Tool authorization, validation and transactions
                                                        --> Database + audit/outbox
                                                        --> Channel adapter reply

Business Admin UI ---> Admin API ---> tenant config / customers / inventory / bookings / inbox / traces
Payment provider ---> Verified webhook ---> payment+order state machine / outbox
Async workers ------> reminders, memory consolidation, embeddings, expiry, delivery retry
```

### Recommended initial stack
- TypeScript monorepo: pnpm + Nx or Turborepo; choose one and document why.
- Admin + embedded web chat: Next.js, React, Tailwind, shadcn/ui, TanStack Query.
- API: NestJS (Fastify adapter) with OpenAPI; keep business services provider-agnostic.
- PostgreSQL + Drizzle ORM or Prisma, `pgvector` for semantic memory/knowledge (start with plain SQL + FTS where sufficient).
- Redis + BullMQ for asynchronous jobs, idempotency keys and optional rate limiting. Redis is not the durable source of truth.
- Object store: S3-compatible for knowledge docs/images.
- LLM: provider abstraction with structured tool calling (Claude-compatible and OpenAI-compatible); configured server-side. Choose a single-agent-with-tools architecture initially.
- Payments: provider adapter with mock gateway first, trusted hosted checkout, signed webhooks.
- Observability: OpenTelemetry traces, structured logs, errors and cost/token accounting. Redact sensitive data.
- Local: Docker Compose Postgres + Redis + optional MinIO; fake WhatsApp/payment providers; seed two tenant demo datasets.

### Why not n8n as central brain?
n8n is acceptable for peripheral automation or simple integrations but critical identity, memory, booking concurrency and payment state should live in typed backend services with comprehensive tests. The LLM runtime should call business APIs, not treat message sequences as a brittle workflow tree.

## 6. Agent behavior: freeform language with governed tools
Maintain a single conversational agent initially. At every turn:
1. Normalize channel event and deduplicate provider message ID.
2. Resolve tenant and customer identity. Unknown user -> ephemeral profile pending verified identification.
3. Load recent turns, compact working summary, consented memory and live business context.
4. Generate response and tool calls using model with typed JSON schemas; never pass SQL/credentials to model.
5. Authorize each tool using tenant, role, verified customer identity, state and operation policy.
6. Execute backend tools; replan on structured errors; do not fabricate results.
7. Require clear customer confirmation for purchase/booking finalization and any material modification. Revalidate price, stock and slots on commit.
8. Store messages, tool records, decision traces and resulting state; send channel response once.
9. Queue memory candidates for validation/consent/retention policy, not indiscriminate storage.
10. Escalate on low confidence, unsupported requests, repeated failures or customer request.

**Model outputs are suggestions, not authorization.** Tool-side checks determine whether an operation may occur. Use Zod validation and explicit JSON tool contracts. Add instruction-injection defenses for retrieved documents and messages. The agent must not be able to invoke unrestricted URLs or arbitrary SQL.

### Required tool interfaces (representative)
```ts
type AgentContext = {
  tenantId: string;
  conversationId: string;
  customerId?: string;
  identityVerified: boolean;
  channel: 'web' | 'whatsapp' | 'instagram';
  locale: string;
};

// Read-only
searchCatalog(ctx, { query, category?, priceMin?, priceMax?, variant? })
getProduct(ctx, { productId })
checkInventory(ctx, { skuId, quantity })
searchAvailability(ctx, { serviceId, staffId?, locationId?, from, to, timezone })
getCustomerBookings(ctx, { status? })  // only identity-confirmed owner
getCustomerOrders(ctx, { status? })     // only identity-confirmed owner
searchBusinessKnowledge(ctx, { query })

// Mutations: state machine + authorization + idempotency key
createBookingHold(ctx, { slotId, expiresAt? }, idempotencyKey)
confirmBooking(ctx, { holdId, confirmationToken }, idempotencyKey)
rescheduleBooking(ctx, { bookingId, newSlotId, confirmationToken }, idempotencyKey)
cancelBooking(ctx, { bookingId, confirmationToken }, idempotencyKey)
updateCart(ctx, { cartId?, skuId, quantity }, idempotencyKey)
createCheckout(ctx, { cartId, confirmationToken }, idempotencyKey)
requestHumanHandoff(ctx, { reason })
proposeMemory(ctx, { fact, sourceMessageIds, type, confidence })
```
Each tool returns `{ok, data?, errorCode?, userSafeMessage?, traceId}` and must be guarded on the server.

## 7. Durable customer memory (differentiator)
### Separate four layers
**A. Recent conversation:** full message stream bounded for prompt context; older turns summarized with pointers to source messages.

**B. Structured profile:** customer name/preferred language; preferences such as preferred staff, location, sizes, dietary considerations only if appropriate and consented. Treat sensitive health attributes separately and default not to persist.

**C. Episodic memory:** evidence-backed customer events, e.g. “asked for a family table last Friday”, “preferred medium roast” and prior order events. Store subject, predicate, value, source, createdAt, lastConfirmedAt, confidence, expiresAt, consentPurpose and tenant scope.

**D. Transaction history:** bookings, orders, carts and payments, always queried from source-of-truth systems. Do not trust model summaries as current transaction facts.

### Memory lifecycle
- Candidate extraction -> policy classifier -> PII/sensitivity filter -> source validation -> dedup/conflict resolution -> explicit consent where required -> storage.
- At next conversation: retrieve only high relevance and fresh memory scoped to same tenant and verified identity. Record which memories were used in a trace.
- Allow “What do you remember about me?”, “Forget my usual order” and “That preference has changed.” Support deletion and correction, including from vector index and caches.
- Do not share customer memories across tenants. If a user contacts multiple businesses, use distinct tenant-scoped customer profiles even if phone number matches.
- Allow memory OFF at business level and per customer; enforce jurisdiction-specific notice, consent and retention decisions with legal review before launch.
- Keep explicit event log and memory write audit. No inferred sensitive attributes or unverified permanent facts.

### Identity linking
- WhatsApp phone IDs are verified by trusted platform events but ensure account ownership checks for sensitive actions and historical data retrieval.
- Web chat starts anonymous. Link to an existing phone identity only through OTP or another verified authentication mechanism.
- Never combine profiles by display name, inferred writing style or unverified phone entry.

### Suggested memory retrieval algorithm
1. Check tenant + verified customer identity + consent flags.
2. Rank facts by semantic relevance, recency, source reliability and confidence.
3. Exclude expired, conflicting or sensitive disallowed entries.
4. Retrieve last relevant transactional events separately.
5. Include at most the few most relevant facts with timestamps and source references.
6. Verify live availability/price/stock independently before action.

### Memory examples
```json
{
  "tenantId": "tenant_salon_1",
  "customerId": "customer_42",
  "kind": "preference",
  "key": "preferred_stylist",
  "value": { "staffId": "maya" },
  "confidence": 0.98,
  "sourceMessageIds": ["msg_123"],
  "lastConfirmedAt": "2026-10-12T13:00:00Z",
  "expiresAt": null,
  "consentPurpose": "personalization"
}
```

## 8. Domain model and critical constraints
All data tables have `tenant_id` and global IDs. Enforce authorization in service layer, tenant filters and optionally PostgreSQL RLS as defense in depth. Suggested tables:
- `tenants`, `tenant_settings`, `users`, `memberships`, `roles`, `channels`, `channel_credentials` (encrypted)
- `customers`, `customer_identities`, `customer_consent`, `customer_preference`, `memories`, `memory_sources`, `memory_events`
- `conversations`, `messages`, `conversation_summaries`, `tool_invocations`, `handoffs`, `agent_runs`
- `locations`, `staff`, `services`, `resources`, `resource_calendars`, `availability_rules`, `booking_holds`, `bookings`, `booking_events`
- `products`, `product_variants`, `inventory_balances`, `inventory_reservations`, `carts`, `cart_items`, `orders`, `order_items`, `payment_intents`, `payment_events`, `shipments`
- `knowledge_documents`, `knowledge_chunks`, `knowledge_sync_events`, `outbox_events`, `webhook_receipts`, `audit_events`.

### Booking engine
Use timezone-aware UTC timestamps internally with IANA timezone on business location and customer-facing output. Resolve daylight-saving transitions. Enforce uniqueness/exclusion against overlapping resource occupancy using transactional locks or PostgreSQL exclusion constraints. Holds expire; booking state machine `draft -> held -> confirmed -> completed`, with legal transitions to `cancelled/expired`. Support service durations, buffers, working hours, holidays, staff capacity and optional deposits. Prevent double booking under concurrent messages.

### Commerce engine
Track monetary values as integer minor units and currency code, never floating point. Include tax/shipping and discounts in pricing engine. Snapshot price and description in order items. Reserve stock atomically at configured transition, release on expiration/cancel. Order state machine `draft -> pending_payment -> paid -> processing -> fulfilled` plus cancelled/failed/refunded transitions as authorized. Webhook processing must verify provider signature and be idempotent. Never mark paid from chat confirmation or untrusted redirect URL.

### Tenant policy controls
Each tenant configures supported intents, branches, hours, services, cancellation policy, upsell limits, allowed tools, memory notice/retention and handoff thresholds. Policies are structured business data, **not scripted chat responses**.

## 9. API outline
```http
POST /v1/chat/sessions
POST /v1/chat/sessions/:id/messages
GET  /v1/chat/sessions/:id/messages
POST /v1/webhooks/whatsapp
POST /v1/webhooks/payments/:provider
GET  /v1/admin/conversations
POST /v1/admin/conversations/:id/takeover
POST /v1/admin/conversations/:id/release
GET  /v1/admin/customers/:id
GET  /v1/admin/customers/:id/memories
PATCH /v1/admin/customers/:id/memories/:memoryId
DELETE /v1/admin/customers/:id/memories/:memoryId
GET  /v1/admin/bookings
GET  /v1/admin/orders
POST /v1/admin/knowledge/documents
GET  /v1/admin/agent-runs/:id
```
Use OpenAPI definitions, cursor pagination, server side validation, tenant-scoped authorization, rate limiting and event versioning. Client-supplied tenant/customer IDs are never trusted as proof of access.

## 10. UX / dashboard requirements
### Business dashboard
- Overview: active AI conversations, humans engaged, confirmed bookings, paid orders, pending payments, conversion funnel, unresolved exceptions.
- Inbox: channel badge, AI/human status, customer identity, conversation timeline, tool activity, takeover/release, assigned owner.
- Customers: timeline of past interactions, orders and bookings; memory view with controls and consent status.
- Calendar: day/week availability, drag-reschedule with validation, capacity and holds.
- Catalog: products/variants, stock, service inventory, sync health.
- AI studio: business knowledge, voice/tone, policies, tool allowlist, simulation tests and audit traces. **Not** a message-template flow builder.
- Settings: team permissions, channel credentials, payment providers and memory retention.

### Web chat
Modern responsive chat drawer and full-page experience, message bubbles, streaming, product cards with source-of-truth price, selectable availability suggestions, live status, accessible controls, transfer to human and customer privacy controls. Text input always remains usable.

## 11. WhatsApp-specific considerations
Use the official WhatsApp Business Platform Cloud API or an approved BSP. Verify webhook challenges and signatures, handle message retries and provider message IDs, respect rate limits and current messaging policies. Freeform replies are governed by the customer-service window; outbound messages outside allowed windows may need approved message templates. This compliance requirement is **not** the same as building the conversational experience from fixed templates. Verify official Meta documentation and regional obligations at implementation time. Support delivery failures and human fallback.

## 12. Security, privacy, reliability
- GDPR/UAE privacy counsel review and jurisdiction-specific customer notice before production; configurable retention and lawful basis.
- Tenant isolation with automated cross-tenant negative tests. Encryption at rest/in transit, KMS/secret manager for tokens, RBAC and audit events.
- Signed webhooks and replay prevention. Rate limiting, spam/abuse detection, PII redaction for logs and model prompts.
- Disable AI replies during human takeover. Concurrency safety for multiple messages and multiple instances.
- Tool outputs and retrieved docs are untrusted inputs. No model-initiated arbitrary API requests, database commands or refunds.
- Data export and erasure flows with backups/retention handling. Backpressure, retries, dead-letter queue and outbox pattern.
- SLO targets to validate, not claim: >=99.9% API availability after production hardening, p95 initial reply <5 seconds under expected load, zero double bookings in concurrency tests, zero false paid statuses.

## 13. Analytics & measurement
Track inquiry -> qualified intent -> verified recommendation/availability -> booking held/cart -> confirmed booking/checkout link -> payment succeeded -> fulfilled, plus human handoffs, containment, median first reply, model tokens/cost, hallucination incidents, tool errors, returning-customer conversion, memory-usage rate and memory correction rate. Instrument metrics by tenant without exposing another tenant's data. Define exact numerator/denominator for every funnel.

## 14. Delivery phases and implementation tickets
**Phase 0, foundations:** monorepo, env validation, CI, Docker, auth/RBAC, tenant isolation, Postgres schema and seed, shared schemas, API specification, health checks.

**Phase 1, functional vertical slice:** one seeded salon tenant and one seeded retail tenant; web chat; agent provider abstraction; tools for read-only business data; reservation check/hold/confirm and product/cart/checkout mock end to end. Implement real transactions and outbox; add test fixtures.

**Phase 2, memory:** identity profiles, session summaries, consent model, extraction pipeline, retrieval, correction/delete, source provenance, returning visitor tests, anonymous-to-verified linking.

**Phase 3, business ops:** dashboard, inbox takeover, booking calendar, orders, catalog, knowledge ingestion, audit views, metrics.

**Phase 4, messaging/payment:** WhatsApp Cloud adapter, signature verification, delivery state, 24-hour compliance controls; production payment adapter, signed webhook reconciliation, retry/dead-letter queue.

**Phase 5, hardening:** load/concurrency testing, security review, tenant isolation test suite, model regression evaluations, observability, docs, production deployment instructions.

Suggested repo:
```text
apps/
  admin-web/
  api/
  web-chat-demo/
  worker/
packages/
  db/
  shared-schemas/
  domain-booking/
  domain-commerce/
  domain-memory/
  agent-runtime/
  channel-adapters/
  provider-adapters/
  ui/
infra/
  docker/
docs/
  ADRs/
```

## 15. Acceptance tests (must automate)
1. Brand-new customer books a real available slot in natural chat; booking appears in admin.
2. Customer requests occupied slot; tool returns unavailable and AI offers real alternatives, not imaginary times.
3. Concurrent attempts for final available slot: at most one succeeds.
4. Returning opted-in customer asks “same as last time”; correct past preference retrieved, current time/price rechecked.
5. Customer says “forget my preferred stylist”; memory removed from active retrieval and future replies.
6. Anonymous web user cannot retrieve existing account order history by typing a phone number.
7. Verified web-to-WhatsApp identity linking preserves tenant-scoped memory without collision.
8. Product stock changes during conversation: checkout revalidates and handles out-of-stock safely.
9. Replay payment webhook: one state transition; order becomes paid only after verified event.
10. Replayed WhatsApp inbound webhook: no duplicate assistant reply/order/booking.
11. Human takes over and AI stops replying immediately.
12. Tenant A API token cannot list or modify Tenant B customers, memories, orders or bookings.
13. Prompt injection inside a knowledge document cannot persuade agent to reveal secrets or bypass policy.
14. Multi-intent booking + product order can complete without losing either state.
15. Failed downstream provider returns a safe explanation and never a fabricated confirmation.
16. Memory denied/off: chat still works and no durable extracted preference is persisted.
17. Dates interpreted in correct business timezone including cross-midnight and DST test cases.
18. Fake integration modes work without third-party credentials; real adapters fail clearly if not configured.

## 16. Launch risks and decisions
| Decision | Recommended default | Reason |
|---|---|---|
| First vertical | Salon appointments + simple retail | Demonstrates both major transaction engines |
| First channel | Web chat demo followed by WhatsApp | Lower integration friction while testing core logic |
| AI architecture | One tool-calling agent | Easier debugging, lower latency/cost |
| Memory | Explicit tenant-scoped persistent memory | Differentiation without privacy ambiguity |
| Knowledge | RAG + structured catalog | General facts from docs, transactions from live systems |
| Payments | Mock first, hosted payment link later | Keeps card data out of chat |
| Channel templates | Only when provider policy requires | Conversational replies remain dynamically generated |
| Backend | Modular monolith initially | Fewer distributed transaction/operations problems |
| Identity | Verified channel identity + OTP linking | Prevents cross-customer data leakage |

## 17. Claude Code execution prompt
Copy the block below into Claude Code with this document in the repository root.

```text
You are the lead architect and implementation engineer for this repository.
Read CLAUDE_CODE_PRD.md fully. Implement it as a real working application, not a static UI prototype.

Constraints:
- Build a multi-tenant TypeScript modular monolith with Next.js admin and web-chat demo, NestJS/Fastify API, PostgreSQL and Redis.
- Provide mocked external adapters so `docker compose up` and the documented startup commands work without paid credentials.
- The conversational AI must not be built using hardcoded template messages or decision-tree flows. Use an LLM tool-calling abstraction with provider selection and server-validated tools.
- Never use an LLM response as proof of availability, payment, identity or authorization.
- Build customer memory in separate conversation, structured-preference, episodic and transaction-history layers. Enforce tenant scope and memory consent.
- Use durable booking/commerce state machines, strict schemas, idempotency and database concurrency controls.
- Implement usable admin screens plus responsive chat and seeded salon/retail demos.
- Keep third-party integration behind clean interfaces, never fabricate working integrations.
- Include tests for double bookings, false payment, cross-tenant exposure, memory forget, handoff and replayed webhooks.
- Include README.md, .env.example, architecture decision records, API docs and a runbook.

Execution order:
1. Inspect existing repository, identify current stack and preserve valuable existing work.
2. Create an implementation plan and a checked task checklist in docs/IMPLEMENTATION_PLAN.md.
3. Scaffold and run the app locally; do not stop after producing a plan.
4. Complete the end-to-end web chat booking and shopping demo with real database persistence.
5. Add consented memory, admin UI and channel/payment adapters.
6. Run migrations, lint, typecheck, tests and a smoke test. Fix failures.
7. Document exactly what works, what is mocked and what needs external credentials.

If a dependency, feature or API has changed, verify its current official documentation. Make implementation decisions with ADRs instead of repeatedly asking questions. Prioritize correctness, security and a running vertical slice over breadth.
```

## 18. Public reference sources
- PAIC: https://paic.chat/
- PAIC order management: https://paic.chat/landings/whatsapp-order-management
- PAIC AI assistant: https://paic.chat/landings/ai-whatsapp-assistant
- OpenAI Agents SDK tools: https://openai.github.io/openai-agents-js/guides/tools/
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Meta developer docs: https://developers.facebook.com/docs/whatsapp/cloud-api/ (confirm current channel policy and availability before implementation)

This document is an architectural proposal based on publicly visible PAIC claims, not a reverse-engineering of PAIC's private infrastructure. Claims about costs, speed and conversion must be validated in a pilot.
