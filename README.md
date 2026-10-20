# ordr.ae-whatsapp

Conversational commerce and booking for UAE businesses: one Claude-driven assistant that books
appointments and sells products over WhatsApp and web chat, with real persistence, consented
customer memory and a merchant dashboard to work the results.

- `apps/api`: NestJS webhook, flow engine, orders, merchant API
- `apps/dashboard`: Next.js landing page and merchant dashboard
- `packages/*`: domain types, WhatsApp client, flow schema, vertical blueprints

See docs/HANDOFF.md for the state of the build, docs/IMPLEMENTATION_PLAN.md for the PRD
checklist, docs/RUNBOOK.md for how to run and verify it (and what is mocked), docs/ADRs for the
decisions, docs/PLAN.md for the older roadmap, and docs/DEPLOY.md to run it on a VPS.
Production: https://app.ordr.ae (web chat demo: https://app.ordr.ae/chat/demo-salon)
