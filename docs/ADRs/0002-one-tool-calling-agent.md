# ADR 0002: One conversational agent with server-validated tools; no scripted flows

Status: accepted, 2026-10-20

## Context
The PRD forbids decision trees and template replies for the conversation and asks for a single
tool-calling agent whose outputs are suggestions, not authorization.

## Decision
- `ConversationAgent` port with an Anthropic implementation (official SDK, tool runner) and a
  scripted fake for tests. Tools are created per message and closed over `tenantId`,
  `customerId` and `conversationId`; the model cannot name another tenant or customer.
- Every mutation goes through a domain service that re-checks state: `SchedulingService`
  (slots, holds, overlap under a row lock), `CommerceService` (stock, cart totals, checkout),
  `MemoryService` (consent). Tool results are strings the model must repeat, never facts it
  may invent.
- Booking and checkout require an explicit customer confirmation turn; the tool is only
  exposed as a two-step hold → confirm, and the confirm tool takes the hold id returned by the
  server.
- The guided JSON flows remain as an optional per-tenant style and as the fallback when the
  model is unavailable. They are not used in the natural style.

## Consequences
- Latency: one to three model calls per customer message; p95 target under 5 seconds with low
  effort and prompt caching of the system prompt.
- Every reply records an `AgentRun` (tools called, tokens, duration, memory used) for audit.
