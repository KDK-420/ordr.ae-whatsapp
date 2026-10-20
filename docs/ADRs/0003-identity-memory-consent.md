# ADR 0003: Customer identity per channel, tenant-scoped memory, explicit consent

Status: accepted, 2026-10-20

## Context
Web chat starts anonymous; WhatsApp identities are verified by Meta. Memory must be tenant
scoped, consented and correctable, and must never be the source of transactional facts.

## Decision
- A `Customer` is tenant scoped and keyed by an identity string: a WhatsApp wa id, or
  `web:<random>` for an anonymous web session. The two are never merged by name or typed phone
  number; linking will go through OTP (Phase 2, open). Web sessions carry a bearer token
  (hashed in `WebSession`); a session only ever sees its own customer's data.
- Memory layers: recent turns (conversation store), structured preferences and episodic facts
  (`Memory` rows with kind, key, value, confidence, source message ids, lastConfirmedAt,
  expiresAt, consentPurpose, deletedAt), and transaction history queried live from orders and
  bookings. No model summary is stored as a transactional fact.
- Consent is a `CustomerConsent` row written by the `record_memory_consent` tool when the
  customer answers the assistant's question; `remember` refuses without it. Tenants can turn
  memory off (`settings.memoryEnabled = false`), in which case nothing is extracted or stored.
- `forget` soft-deletes (deletedAt) and the retrieval excludes deleted, expired and other
  tenants' rows. Sensitive attributes (health, religion, etc.) are not persisted: the prompt
  forbids proposing them and the service rejects keys on a deny list.

## Consequences
- Returning customers get "same as last time" only with consent and only after the live
  availability check.
- Jurisdictional notice text and retention defaults need legal review before launch; the
  retention field exists (`expiresAt`) and defaults to 365 days for preferences.
