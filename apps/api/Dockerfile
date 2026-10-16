# syntax=docker/dockerfile:1
# Builds the @ordr/api service from the monorepo root. Build context must be the repo root:
#   docker build -f apps/api/Dockerfile -t ordr/api .
# deploy/compose.yml does this for you.

FROM node:22-bookworm-slim AS build
ENV TURBO_TELEMETRY_DISABLED=1 \
    CI=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.14.0
WORKDIR /app

# Fetch dependencies from the lockfile alone so this layer survives source changes.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm build

# Runtime image. Carries node_modules unpruned so `prisma migrate deploy` (entrypoint)
# and `tsx prisma/seed.ts` (deploy.sh --seed) work without extra tooling.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]
