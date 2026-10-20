# ADR 0001: Keep the existing stack (NestJS on Express, Prisma, Turborepo)

Status: accepted, 2026-10-20

## Context
The PRD suggests NestJS with the Fastify adapter, Drizzle or Prisma, and Nx or Turborepo. The
repository already runs NestJS on Express with Prisma and Turborepo, with tests, a deploy
pipeline and production traffic.

## Decision
Keep Express, Prisma and Turborepo. Business services stay provider-agnostic behind the ports in
`apps/api/src/ports.ts`, with in-memory and Prisma adapters for every port.

## Consequences
- No migration cost; the vertical slice ships on the current foundation.
- Fastify can be swapped in later behind Nest's adapter boundary if throughput requires it.
- Turborepo caching and task graph already cover build, typecheck and test.
