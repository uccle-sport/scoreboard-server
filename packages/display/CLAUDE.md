# CLAUDE.md

## Project Overview

Big-screen display app for live sports scoreboards. Renders the live scoreboard (scores, timer, team names, period) on a projector or large screen. Connects to the scoreboard server via Socket.IO and updates in real time.

Served at `/` by the Express server. Build output goes to `packages/server/public/` via Vite's `build.outDir` (with `emptyOutDir: true` — wipes the directory on each build).

## Commands

- `yarn dev` — Start dev server on port 8081
- `yarn build` — Production build (output to packages/server/public/)
- `yarn lint` — ESLint

## Tech Stack

- React 18 + TypeScript + Vite (SWC)
- shadcn/ui + Tailwind CSS
- Socket.IO client for real-time sync with scoreboard server

## Architecture

Single component: `src/components/Scoreboard.tsx` renders the full-screen display. State arrives from the server via:
- Initial `sync` event on connect
- Live `update` events for real-time changes

The component maintains `pausedRef`, `remainingRef`, and `endDateRef` to avoid stale closure issues in the `useInterval` timer callback.

## URL Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `uuid` | yes | Scoreboard UUID to display |
| `secret` | yes | Authentication token |
| `socket-io-url` | no | Override server URL |

## Build Note

**Build order matters.** This package's build wipes `packages/server/public/` entirely (`emptyOutDir: true`). Always build display before app so the admin app build can restore `packages/server/public/admin/` afterwards. The root `yarn build` script enforces this order: `display → app → server`.