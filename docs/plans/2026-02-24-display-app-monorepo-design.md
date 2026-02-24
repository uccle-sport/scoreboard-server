# Display App Monorepo Integration — Design

**Date:** 2026-02-24

## Goal

Import `scoreboard-iot-ui` (the big-screen display app) into the monorepo as `packages/display/`, served at `/` by the Express server.

## Current State

- `packages/server/public/` serves Express static files
- `packages/server/public/admin/` — React admin app (built by `packages/app`)
- `packages/server/public/index.html` — hand-written display page (to be replaced)
- `packages/server/public/img/`, `assets/` — old display page assets (to be replaced)

## Design

### Package name
`@scoreboard/display` in `packages/display/package.json`

### Vite build output
- `outDir`: `../server/public`
- `emptyOutDir`: `true` — wipes the entire `public/` on each build (prevents hash-named bundle accumulation)

### Build order (root `build` script)
```
display → app → server
```

1. Display build wipes `public/` and outputs the iot-ui React app at `/`
2. App build writes to `public/admin/` (its own `emptyOutDir: true` only wipes that subdirectory)
3. Server compiles TypeScript

This ensures no stale hashed assets accumulate in `public/` between builds.

### Dev
`yarn dev` already runs all workspaces via `foreach`. Display dev server runs on a port distinct from the admin app (8080). The iot-ui currently uses port 8080 — update it to **8081** to avoid conflict.

### Old display page
`packages/server/public/index.html` and sibling artifacts (`img/`, `assets/`) are deleted from the repo. They will be replaced by the iot-ui's build output on first `yarn build`.

### No base path change
The display app serves at `/` (Vite default, no `base` override needed).