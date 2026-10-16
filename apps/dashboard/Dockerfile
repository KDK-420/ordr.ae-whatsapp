# syntax=docker/dockerfile:1
# Builds the merchant dashboard (Next.js, standalone output) from the monorepo root:
#   docker build -f apps/dashboard/Dockerfile -t ordr/dashboard .
# deploy/compose.yml does this for you.

FROM node:22-bookworm-slim AS build
ENV TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN npm install -g pnpm@10.14.0
WORKDIR /app

COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
# Baked into the rewrite for /merchant/*; Caddy routes that path to the API before Next sees it in production.
ARG API_INTERNAL_URL=http://api:3000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @ordr/dashboard build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001
WORKDIR /app
# The standalone bundle keeps the monorepo layout: the server lives at apps/dashboard/server.js.
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=node:node /app/apps/dashboard/public ./apps/dashboard/public
USER node
EXPOSE 3001
CMD ["node", "apps/dashboard/server.js"]
