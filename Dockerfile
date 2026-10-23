# syntax=docker/dockerfile:1
#
# Server image. The Express server serves its own API/WebSocket endpoints plus the
# pre-built display app (at "/") and admin app (at "/admin/"), so the build stage
# compiles both frontends into packages/server/public and the server into a single
# standalone executable; the runtime stage is `scratch` with just those.
#
# Build from the repository root (the build context must include all workspaces):
#   docker build -t scoreboard-server .

# Pin the Bun version in one place; override with --build-arg BUN_VERSION=…
ARG BUN_VERSION=1.4.4

# --- build: install workspace deps, build the frontends, compile the server ---
FROM oven/bun:${BUN_VERSION}-alpine AS build
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

# Bundle the server and its deps into one executable. Inside it import.meta.url
# points at the embedded /$bunfs filesystem, so the static files are located via
# PUBLIC_DIR (set below) rather than relative to the sources.
RUN bun build ./packages/server/src/index.ts \
    --compile \
    --minify \
    --sourcemap \
    --no-compile-autoload-dotenv \
    --outfile /app/server

# --- runtime: nothing but the binary, its musl/libstdc++ shared libs, CA roots and public/ ---
FROM scratch
WORKDIR /app

# the compiled binary dynamically links these (bun-alpine builds are not fully static)
COPY --from=build /lib/ld-musl-*.so.1 /lib/
COPY --from=build "/usr/lib/libstdc++.so.6" /usr/lib/
COPY --from=build /usr/lib/libgcc_s.so.1 /usr/lib/

# CA roots for the outbound HTTPS calls to Flowr (channels, logos, device webhooks)
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /app/server /app/server
COPY --from=build /app/packages/server/public /app/public

ENV NODE_ENV=production
ENV PORT=5000
ENV PUBLIC_DIR=/app/public

USER 65532:65532
EXPOSE 5000
ENTRYPOINT ["/app/server"]
