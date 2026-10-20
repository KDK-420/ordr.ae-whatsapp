# ADR 0004: Mock payment provider first; paid only on a verified webhook

Status: accepted, 2026-10-20

## Context
Card data must never be collected in chat. The PRD requires hosted checkout, signed webhooks,
idempotent processing and that an order is never marked paid from chat or a redirect.

## Decision
- `PaymentProvider` port with a `MockPaymentProvider`: `createCheckout` returns a hosted page
  (`/pay/<intentId>` in the dashboard app) and the provider signs its webhook with an HMAC over
  the body using `PAYMENT_WEBHOOK_SECRET`. The API endpoint `/v1/webhooks/payments/mock`
  verifies the signature, records the receipt by provider event id (replay → no-op) and moves
  the order `pending_payment → paid` exactly once.
- Retail order state machine: `pending_payment → paid → processing → fulfilled`, with
  `cancelled` and `failed`. Stock is reserved at checkout (atomic `UPDATE ... WHERE stock >=`)
  and released when the intent expires or fails.
- Money stays in integer minor units with a currency code; order items snapshot title, variant
  and price.

## Consequences
- `docker compose up` works without any payment credentials; a real provider (Stripe, Telr,
  Ziina) implements the same port and its own signature check.
- The mock page is a stand-in for a hosted checkout and must not be exposed as a real one.
