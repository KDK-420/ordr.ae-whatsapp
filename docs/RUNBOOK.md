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
  customers (`web:` ids) and demo customers (`000` ids) never reach Meta. Every inbound message
  is marked read; when the bot is going to answer, the read receipt carries Meta's typing
  indicator, so the customer sees "typing…" until the reply lands (Meta clears it after 25 s).
  Outbound notifications, reminders and inbox replies go out on the channel the customer's
  conversation is on; a tenant's newest active number is used only when there is no thread.
- **Identity linking.** Web visitors are anonymous (`web:<random>` per session). Linking a web
  visitor to a verified WhatsApp identity is Phase 2 (OTP); until then memories consented in
  web chat belong to that anonymous identity only.
- **Handoff alerts.** When the agent calls `hand_over_to_human` (or a guided flow hands off),
  `ConversationService` pauses the thread and emits `conversation.handed_over` through the
  outbox (payload: conversation and customer ids, name, `waId`, the last inbound text or media
  preview, the agent's reason). `HandoffNotifier` (worker on Postgres; in process in memory
  mode) sends a WhatsApp message from the number the customer wrote on to every number in the
  tenant setting `handoffNumbers` (Settings › Conversation › "Who to alert on WhatsApp when the
  bot hands over"; E.164 digits, at most 5). A staff number that wrote to the business within
  24 hours gets a plain text with the reason; otherwise the `ordr_handoff_alert` utility
  template (`{{1}}` customer, `{{2}}` preview, `{{3}}` inbox link), submitted with the other
  defaults from Settings › WhatsApp templates and skipped with a warning until it is approved.
  The link is `PUBLIC_BASE_URL/inbox`. The dashboard shows the number of threads waiting for a
  person next to "Inbox"; on the inbox page a new handoff plays a short chime (the "Sound on/off"
  button mutes it, remembered per browser in localStorage; browsers only play it after the first
  click or key on the page) and, once "Notify me" has been allowed there, a browser notification.
  Web chat and demo customers' own ids are never alerted; staff numbers are always real.
- **Push notifications (phones).** `HandoffPushNotifier` also handles `conversation.handed_over`:
  it sends a Web Push ("<customer> needs a person", the preview, opens `/inbox`) to every device
  the tenant's users registered, and deletes subscriptions the push service answers 404/410 for.
  Setup: run `pnpm --filter @ordr/api push:keys` once, put the pair in `WEB_PUSH_PUBLIC_KEY` and
  `WEB_PUSH_PRIVATE_KEY` (GitHub secrets of the same name reach `deploy/.env` on the next deploy;
  `WEB_PUSH_SUBJECT` is a `mailto:` push services may contact, default `mailto:hello@ordr.ae`) and
  restart the API and worker. Without both keys `GET /merchant/push/public-key` answers 503 and the
  toggle says push is not set up. Rotating the keys invalidates every stored subscription; staff
  turn the toggle off and on again. Each person turns it on per device under Settings › "Notify me
  on this device": the page registers `public/sw.js`, asks for permission, subscribes with the
  public key and `POST`s it to `/merchant/push/subscribe` (`DELETE` removes it); rows live in
  `PushSubscription` and die with the user. **iPhone and iPad:** Apple delivers Web Push only to a
  web app on the home screen, so staff first open the dashboard in Safari, Share › Add to Home
  Screen (the manifest at `/manifest.webmanifest` names it "ordr.ae"), open it from there, sign in
  and then turn the toggle on; the toggle explains this when it detects an iPhone in the browser.
- **Housekeeping.** Expired holds and unpaid checkouts are released by `MaintenanceService`
  (worker process on Postgres; the API itself in memory mode), every minute.

## Inbound media (images, voice notes, documents)

What a customer sends besides text now reaches the conversation engine instead of silently
dropping them into the guided menu.

| Sent | Natural style | Guided style | Stored payload (`handling`) |
| --- | --- | --- | --- |
| Image with caption | Caption is the message text; the photo goes to Claude as an image block (JPEG, PNG, GIF, WebP, up to 5 MB) | Caption ignored, flow continues | `image_attached`, `too_large`, `download_failed` or `skipped` |
| Image, no caption | `[sent an image]` plus the image block | Flow continues | as above |
| Voice note | Transcribed when `TRANSCRIPTION_PROVIDER` is set, else the agent reads `[sent a voice note]` and asks the customer to type | Flow continues | `transcribed` (with `transcript`) or `not_transcribed` |
| Video, sticker, document | Caption, or `[sent a video]`, `[sent a sticker]`, `[sent a document: name]`; nothing downloaded | Flow continues | `skipped` |

The pieces:

- `textOf` / `describeMedia` (`apps/api/src/conversation/inbound-text.ts`) turn content into the
  words the agent sees. The system prompt tells the agent what a bracketed note means.
- `InboundMediaService` (`apps/api/src/conversation/inbound-media.service.ts`) downloads and
  transcribes before the message is stored; it never throws, a failed fetch degrades to the
  caption or note so the customer still gets an answer.
- `downloadMedia(mediaId, accessToken)` on the `MessageSender` port (`@ordr/whatsapp`). The Cloud
  API client does Meta's two steps (`GET /{media-id}` for a short-lived URL, then the URL with the
  same bearer token) and enforces `maxBytes` before and after fetching. `WHATSAPP_SENDER=log`
  refuses with `MediaError("unavailable")`; `FakeSender.media` serves bytes in tests.
- The stored inbound payload is the parsed content plus `text` (what the engine read), `handling`,
  `transcript`, `sizeBytes` and `error`. The inbox preview reads "Image: <caption>",
  "Voice note: <transcript>", "<filename>"; agent history uses `text`, so a photo turn stays
  meaningful in later messages.
- `GET /merchant/conversations/:id/media/:messageId` streams the bytes of an inbound media message
  (fetched from Meta on demand, nothing stored on our side; Meta keeps media about 30 days). The
  inbox renders inbound images through it.

Still mocked or missing:

- **Transcription.** Claude's API has no audio input (`@anthropic-ai/sdk` 0.135.0 has no audio
  content block), so voice notes go through a speech-to-text provider first.
  `TRANSCRIPTION_PROVIDER=openai` with `TRANSCRIPTION_API_KEY` (an OpenAI key) sends each note to
  OpenAI's transcription endpoint (`TRANSCRIPTION_MODEL`, default `gpt-4o-mini-transcribe`, Arabic
  and English); `none` describes the note to the agent instead. The VPS workflow turns it on when
  the `TRANSCRIPTION_API_KEY` (or `OPENAI_KEY`) secret exists. Another provider implements
  `Transcriber` (`apps/api/src/ai/transcriber.ts`) and gets a case in `createTranscriber`.
  `FakeTranscriber` stands in for it in `test/media.e2e.test.ts`.
- **Documents** are described, not read. PDFs could go to Claude as document blocks behind the same
  service once there is a reason to.
- **Images in guided style** are never downloaded; the flows cannot use them.
- Media is downloaded even when a human owns the thread, so the inbox shows the transcript.

## Configuration added this round

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:3001` | Where customers reach the web pages; used in payment links |
| `PAYMENT_PROVIDER` | `mock` | Payment adapter |
| `PAYMENT_WEBHOOK_SECRET` | falls back to `AUTH_SECRET`, then `META_APP_SECRET` | Signs and verifies payment webhooks |
| `HOLD_MINUTES` | 10 | How long a held slot stays reserved |
| `CHECKOUT_MINUTES` | 30 | How long a payment link stays valid and stock stays reserved |
| `MEMORY_RETENTION_DAYS` | 365 | Expiry of remembered preferences |
| `TRANSCRIPTION_PROVIDER` | `none` | Speech to text for voice notes; `none` describes them to the agent instead |
| `TRANSCRIPTION_API_KEY` | empty | Key for the transcription provider, unused with `none` |
| `DEMO_CHAT_SLUG` (dashboard) | empty | Tenant slug behind the landing page's "Try the demo in web chat" button |

Per tenant, in `tenant.settings`: `memoryEnabled` (default true; false disables memory tools
and recall), `conversationStyle` (`natural` or `guided`), `facts`, `profile`, `handoffNumbers`
(staff WhatsApp numbers alerted on a bot-to-human handoff, see above).

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
