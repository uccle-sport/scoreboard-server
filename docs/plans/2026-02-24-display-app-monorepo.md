# Display App Monorepo Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import `scoreboard-iot-ui` into the monorepo as `packages/display/`, serving the React display app at `/` and wiping the old hand-written display page.

**Architecture:** Same pattern as `packages/app` — copy source from the sibling directory, update `package.json` name and `build` script, add `build.outDir`/`emptyOutDir` to `vite.config.ts`, update the root build order. Display builds first (wipes `public/`), then app (restores `public/admin/`), then server.

**Tech Stack:** Yarn 4 workspaces, Vite 5, React 18, TypeScript, shadcn/ui, Socket.IO client

---

### Task 1: Import scoreboard-iot-ui as packages/display

**Files:**
- Create: `packages/display/` (copied from `../scoreboard-iot-ui`)
- Modify: `packages/display/package.json`
- Modify: `packages/display/vite.config.ts`

**Step 1: Copy the source into the monorepo**

```bash
cp -r /Users/aduchate/Sources/github/rus/scoreboard-iot-ui packages/display
```

**Step 2: Remove git/build/install artifacts**

```bash
rm -rf packages/display/.git \
       packages/display/node_modules \
       packages/display/dist \
       packages/display/.yarn \
       packages/display/.idea \
       packages/display/yarn.lock \
       packages/display/package-lock.json \
       packages/display/bun.lockb
```

**Step 3: Update `packages/display/package.json`**

Make these changes (keep everything else as-is):
- `"name"` → `"@scoreboard/display"`
- `"build"` script → `"vite build"` (remove the `rm -rf` and `rsync` suffix — Vite `outDir` handles output)
- Remove the `"packageManager"` field (inherited from monorepo root)

The result should look like:
```json
{
  "name": "@scoreboard/display",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  ...all dependencies unchanged...
}
```

**Step 4: Update `packages/display/vite.config.ts`**

Add `build.outDir` and `build.emptyOutDir` to the existing config. Also change the dev server port to `8081` (avoids conflict with the admin app on `8080`).

The full updated file:

```typescript
// Polyfill crypto.hash for Node versions < 19 that don't expose crypto.hash
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nodeCrypto = require('node:crypto');
if (typeof nodeCrypto.hash !== 'function') {
  nodeCrypto.hash = async (algorithm: string, data: Uint8Array | string) => {
    const h = nodeCrypto.createHash(algorithm);
    h.update(data);
    return h.digest();
  };
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode !== "development" &&
      legacy({
        targets: ["ie >= 11"],
        additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2015",
    outDir: path.resolve(__dirname, "../server/public"),
    emptyOutDir: true,
  },
}));
```

**Step 5: Commit**

```bash
git add packages/display
git commit -m "chore: import scoreboard-iot-ui as packages/display"
```

---

### Task 2: Install dependencies and update root build script

**Files:**
- Modify: `package.json` (root — update `build` script)

**Step 1: Run yarn install to pick up the new workspace**

```bash
yarn install
```

Expected: Yarn resolves `packages/display` as a new workspace, installs its dependencies.

**Step 2: Verify the display app builds**

```bash
yarn workspace @scoreboard/display run build
```

Expected: Build succeeds, `packages/server/public/` is populated with the display app's output (new `index.html`, `assets/`, etc.). The old `index.html` and `img/` directory are gone.

**Step 3: Verify the admin app still builds correctly after display**

```bash
yarn workspace @scoreboard/app run build
```

Expected: `packages/server/public/admin/` is (re)populated. The display app files at `public/` root are untouched.

**Step 4: Update the root `build` script in `package.json`**

Change from:
```json
"build": "yarn workspace @scoreboard/app run build && yarn workspace @scoreboard/server run build"
```

To:
```json
"build": "yarn workspace @scoreboard/display run build && yarn workspace @scoreboard/app run build && yarn workspace @scoreboard/server run build"
```

**Step 5: Verify the full `yarn build` works**

```bash
yarn build
```

Expected: All three packages build in order. Final state of `packages/server/public/`:
- `index.html` — display app entry
- `assets/` — display app JS/CSS bundles
- `admin/` — admin app (index.html + assets/)
- Any static files copied from `packages/display/public/` (favicon.ico, robots.txt, placeholder.svg)

**Step 6: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore: add display package to monorepo build pipeline"
```

---

### Task 3: Remove old hand-written display page from git

**Files:**
- Delete: `packages/server/public/index.html` (old hand-written display)
- Delete: `packages/server/public/assets/` (old display JS/CSS)
- Delete: `packages/server/public/img/` (old display images)

**Step 1: Remove old static files from git tracking**

These files are now generated by the display build and should not be checked in:

```bash
git rm -r packages/server/public/index.html \
           packages/server/public/assets \
           packages/server/public/img \
           packages/server/public/favicon.ico \
           packages/server/public/placeholder.svg \
           packages/server/public/robots.txt
```

(Some of these may already be absent if the display build already replaced them. Run `git status` first to see what's tracked.)

**Step 2: Add `packages/server/public/` to `.gitignore` except for `admin/`**

The display build output should not be committed — it's generated. Add to `.gitignore`:

```
packages/server/public/assets/
packages/server/public/index.html
packages/server/public/favicon.ico
packages/server/public/placeholder.svg
packages/server/public/robots.txt
```

> Note: `packages/server/public/admin/` is also generated — if it is already gitignored, good. If not, add it too.

**Step 3: Verify git status is clean after ignoring generated files**

```bash
git status packages/server/public/
```

Expected: No untracked or modified files under `public/` (all generated output is gitignored).

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: remove old display page, gitignore generated public/ output"
```

---

### Task 4: Update documentation

**Files:**
- Modify: `CLAUDE.md` (root)
- Create: `packages/display/CLAUDE.md`

**Step 1: Create `packages/display/CLAUDE.md`**

```markdown
# CLAUDE.md

## Project Overview

Big-screen display app for live sports scoreboards. Renders the live scoreboard (scores, timer, team names, period) on a projector or large screen. Connects to the scoreboard server via Socket.IO and updates in real time.

Served at `/` by the Express server. Build output goes to `packages/server/public/` via Vite's `build.outDir`.

## Commands

- `yarn dev` — Start dev server on port 8081
- `yarn build` — Production build (output to packages/server/public/)
- `yarn lint` — ESLint

## Tech Stack

- React 18 + TypeScript + Vite (SWC)
- shadcn/ui + Tailwind CSS
- Socket.IO client for real-time sync with scoreboard server
- Legacy browser support via @vitejs/plugin-legacy (IE11+)

## Architecture

Single component: `src/components/Scoreboard.tsx` renders the full-screen display. State comes from the server via:
- Initial `sync` event on connect
- Live `update` events for real-time changes

## URL Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `uuid` | yes | Scoreboard UUID to display |
| `secret` | yes | Authentication token |
| `socket-io-url` | no | Override server URL |
```

**Step 2: Update root `CLAUDE.md` to mention the display package**

Add `packages/display/` to the Structure section and update the build order in Commands:

```markdown
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
```

**Step 3: Commit**

```bash
git add CLAUDE.md packages/display/CLAUDE.md
git commit -m "docs: add display package to CLAUDE.md files"
```