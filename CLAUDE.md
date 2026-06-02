# CLAUDE.md

## Project Overview

Scoreboard monorepo: a real-time sports scoreboard system with an Express+Socket.IO server and a React admin interface.

## Structure

- `packages/server/` — Express + Socket.IO backend (TypeScript)
- `packages/app/` — React admin interface (TypeScript, Vite, shadcn/ui)
- `packages/display/` — React big-screen display app (TypeScript, Vite, shadcn/ui)

## Commands

- `bun install` — Install all workspace dependencies
- `bun run dev` — Start all three packages in dev mode
- `bun run build` — Build display, then app, then type-check the server
- `bun run start` — Run the server in production
- `bun run --filter @scoreboard/server dev` — Server only
- `bun run --filter @scoreboard/app dev` — Admin app only (port 8080)
- `bun run --filter @scoreboard/display dev` — Display app only (port 8081)
- `bun run test:e2e` — Build, then run the Playwright e2e suite

## Tech Stack

- Bun workspaces (Bun is the runtime, package manager, and script runner)
- Server: Express, Socket.IO, TypeScript — Bun runs the `.ts` sources directly (no compile step); `build` is `tsc --noEmit` for type-checking
- App: React 18, Vite (SWC), shadcn/ui, Tailwind CSS, Socket.IO client

## Deployment

- `Dockerfile` (repo root) builds the server image: a multi-stage build that compiles both frontends into `packages/server/public`, then runs `bun run src/index.ts` on an `alpine-glibc` base with the Bun binary copied in. Build from the repo root: `docker build -t scoreboard-server .`

## Key Files

- `packages/server/src/index.ts` — Server entry point
- `packages/server/src/socket.ts` — Socket.IO event handlers
- `packages/server/src/state.ts` — Scoreboard state management
- `packages/server/src/config.ts` — Environment variable configuration
- `packages/app/src/pages/Index.tsx` — App main page with state management
- `packages/display/src/components/Scoreboard.tsx` — Big-screen display component
