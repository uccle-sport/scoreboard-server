# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scoreboard management single page app for live sports (basketball-style quarters/halves). This is the **admin interface** that controls a remote scoreboard display via Socket.IO. It is served under the `/admin/` base path. Build output goes directly to `packages/server/public/admin/` via Vite's `build.outDir`.

## Commands

- `yarn dev` — Start dev server on port 8080
- `yarn build` — Production build (output to packages/server/public/admin/)
- `yarn build:dev` — Development build
- `yarn lint` — ESLint

## Tech Stack

- React 18 + TypeScript + Vite (SWC)
- shadcn/ui (default style, CSS variables, no RSC) + Tailwind CSS
- Socket.IO client for real-time sync with scoreboard server
- react-router-dom with `basename="/admin"`
- Package manager: Yarn 4 (Corepack)

## Architecture

**Single-page app with two tabs** managed by state in `src/pages/Index.tsx` (not routes):
- **ScoreboardScreen** — score +/- buttons, countdown timer, period/quarter selection
- **SettingsScreen** — team names, on/off power toggle, QR code sharing

All scoreboard state lives in `Index.tsx` and flows down as props. State changes from the UI set a `localChangeRef` flag, which triggers a Socket.IO `update` emit in a `useEffect`. Incoming `update` events from the server update local state (optimistic concurrency with `rev` field; 409 triggers a re-sync).

**Socket.IO** (`src/hooks/use-socket.tsx`): Singleton socket connection. Auth via URL query params `?secret=...&uuid=...`. Optional `socket-io-url` param overrides the server URL.

**Timer**: Countdown managed client-side via `useInterval` (1s). When running, `remaining` is derived from `endDate`; when paused, `endDate` is recalculated from `remaining`.

## Path Aliases

`@/` maps to `./src/` (configured in both tsconfig and vite).

## Key Conventions

- UI components in `src/components/ui/` are shadcn/ui primitives — add new ones via `npx shadcn-ui@latest add <component>`
- Icons from `lucide-react`
- Custom glow effects via `glow-primary`, `glow-accent`, `text-glow` CSS classes
