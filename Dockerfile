# syntax=docker/dockerfile:1.7

# ---- deps stage ----------------------------------------------------------
# Resolve and install production + dev dependencies. We keep dev deps because
# the runtime stage uses tsx to execute TypeScript directly (no compile step
# yet — see plan deferred items).
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- runtime stage -------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

EXPOSE 3000

# tsx loader runs the TS entrypoint directly. Switch to compiled JS once
# tsconfig.noEmit is flipped (deferred per CI plan).
CMD ["pnpm", "start"]
