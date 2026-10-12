# Image for the API (Fastify + Socket.io), built by Render from render.yaml.
#
# This service cannot go on a serverless host: Socket.io needs a process that
# stays alive between requests, and the whole realtime layer (customer order
# tracking, KDS cards, cashier notifications) depends on it.
#
# It lives at the repo root because the build context has to be the root for
# pnpm workspace links to resolve (render.yaml: dockerContext ".").
FROM node:22-slim

# Prisma's query engine links against OpenSSL; the slim image does not carry it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Manifests first so the dependency layer is cached until a package.json
# actually changes. Every workspace manifest is copied — pnpm validates the
# lockfile against the whole workspace, even when installing a subset.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/customer/package.json apps/customer/
COPY apps/kds/package.json apps/kds/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/

# `api...` = the API plus its workspace dependencies; the three Next apps are
# never installed here. NODE_ENV is still unset, so devDependencies (the
# Prisma CLI, tsx, TypeScript) are available for the build below.
RUN pnpm install --frozen-lockfile --filter api...

COPY packages/ packages/
COPY apps/api/ apps/api/

RUN pnpm --filter @malalabar/db generate
# Emits nothing (the shared tsconfig sets noEmit) — this is the type gate, and
# a failed typecheck should fail the deploy rather than reach production.
RUN pnpm --filter api build

ENV NODE_ENV=production
# Render injects PORT (default 10000); config.ts falls back to 4000 locally.
EXPOSE 4000

# Migrations run at boot. Safe for the single instance this product needs; if
# the API is ever scaled past one replica, move this to a release step so two
# containers cannot race each other.
CMD ["sh", "-c", "pnpm --filter @malalabar/db exec prisma migrate deploy && pnpm --filter api start"]
