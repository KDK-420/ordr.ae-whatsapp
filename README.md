# ordr.ae-whatsapp

WhatsApp ordering for UAE businesses: a bot that takes orders over the WhatsApp Cloud API and a
merchant dashboard to work them.

- `apps/api`: NestJS webhook, flow engine, orders, merchant API
- `apps/dashboard`: Next.js landing page and merchant dashboard
- `packages/*`: domain types, WhatsApp client, flow schema, vertical blueprints

See docs/HANDOFF.md for the state of the build, docs/PLAN.md for the roadmap, and
docs/DEPLOY.md to run it on a VPS. Production: https://app.ordr.ae
