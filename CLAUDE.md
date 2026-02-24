# CLAUDE.md

## Project Overview

Scoreboard monorepo: a real-time sports scoreboard system with an Express+Socket.IO server and a React admin interface.

## Structure

- `packages/server/` — Express + Socket.IO backend (TypeScript)
- `packages/app/` — React admin interface (TypeScript, Vite, shadcn/ui)
- `packages/display/` — React big-screen display app (TypeScript, Vite, shadcn/ui)

## Commands

- `yarn dev` — Start all three packages in dev mode
- `yarn build` — Build display, then app, then compile server
- `yarn start` — Run compiled server in production
- `yarn workspace @scoreboard/server run dev` — Server only
- `yarn workspace @scoreboard/app run dev` — Admin app only (port 8080)
- `yarn workspace @scoreboard/display run dev` — Display app only (port 8081)

## Tech Stack

- Yarn 4 workspaces (Corepack)
- Server: Express, Socket.IO, TypeScript, tsx (dev)
- App: React 18, Vite (SWC), shadcn/ui, Tailwind CSS, Socket.IO client

## Key Files

- `packages/server/src/index.ts` — Server entry point
- `packages/server/src/socket.ts` — Socket.IO event handlers
- `packages/server/src/state.ts` — Scoreboard state management
- `packages/server/src/config.ts` — Environment variable configuration
- `packages/app/src/pages/Index.tsx` — App main page with state management
- `packages/display/src/components/Scoreboard.tsx` — Big-screen display component
