# syntax=docker/dockerfile:1
#
# Server image. The Express server serves its own API/WebSocket endpoints plus the
# pre-built display app (at "/") and admin app (at "/admin/"), so the build stage
# compiles both frontends into packages/server/public before the runtime stage runs
# the TypeScript server directly with Bun.
#
# Build from the repository root (the build context must include all workspaces):
#   docker build -t scoreboard-server .

# Pin the Bun version in one place; override with --build-arg BUN_VERSION=1.3.10
ARG BUN_VERSION=1.3.10

# Stage that provides the Bun binary — reused by the build stage and copied into runtime.
FROM oven/bun:${BUN_VERSION} AS bun

# --- Build stage: install workspace deps and build the frontends ---
FROM bun AS build
WORKDIR /app

# Copy manifests + lockfile first so dependency installs are cached across source changes.
COPY package.json bun.lock ./
COPY packages/server/package.json ./packages/server/
COPY packages/app/package.json ./packages/app/
COPY packages/display/package.json ./packages/display/
RUN bun install --frozen-lockfile

# Build the display (→ public/) and admin (→ public/admin/) apps. Order matters:
# display empties public/ first, then app populates public/admin/.
COPY . .
RUN bun run --filter @scoreboard/display build \
 && bun run --filter @scoreboard/app build

# --- Runtime stage: Alpine + glibc with just the Bun binary copied in ---
FROM frolvlad/alpine-glibc
COPY --from=bun /usr/local/bin/bun /usr/local/bin/

WORKDIR /app

# Install production dependencies only (skips Vite/TS/ESLint and the rest of the
# build tooling). Uses the same lockfile resolved in the build stage.
COPY package.json bun.lock ./
COPY packages/server/package.json ./packages/server/
COPY packages/app/package.json ./packages/app/
COPY packages/display/package.json ./packages/display/
RUN bun install --production --frozen-lockfile

# Server sources and the frontends built in the build stage.
COPY tsconfig.base.json ./
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/server/src ./packages/server/src
COPY --from=build /app/packages/server/public ./packages/server/public

WORKDIR /app/packages/server

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# Bun runs the TypeScript entry point directly — no compile step.
CMD ["bun", "run", "src/index.ts"]
