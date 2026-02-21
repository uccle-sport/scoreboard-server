# TypeScript Migration & Monorepo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the scoreboard-server from JavaScript to TypeScript and reorganize as a Yarn workspaces monorepo with both the server and the React frontend (flash-score-app).

**Architecture:** The current single-repo Express+Socket.IO server (180 lines of JS) becomes `packages/server/` with TypeScript source split into modules. The React frontend from `../flash-score-app` becomes `packages/app/`. Root package.json orchestrates both via Yarn workspaces.

**Tech Stack:** Node.js, Express, Socket.IO, TypeScript, tsx (dev runner), Vite, React, Yarn 4 workspaces

---

## Phase 1: Monorepo Scaffolding

### Task 1: Create packages directory and move server code

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/src/` (empty dir for now)
- Move: `public/` → `packages/server/public/`
- Move: `index.js` → `packages/server/index.js` (temporary, will be replaced)
- Modify: `package.json` (root — add workspaces)

**Step 1: Create `packages/server/` directory structure**

```bash
mkdir -p packages/server/src
```

**Step 2: Move server files into `packages/server/`**

```bash
mv index.js packages/server/
mv public packages/server/
```

**Step 3: Create `packages/server/package.json`**

```json
{
  "name": "@scoreboard/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.17.1",
    "node-fetch": "2.7.0",
    "socket.io": "^4.0.0",
    "uuid": "^8.3.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.16.5",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.3"
  }
}
```

**Step 4: Update root `package.json` to be the workspace root**

```json
{
  "name": "scoreboard",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "yarn workspaces foreach -Api -j unlimited run dev",
    "build": "yarn workspace @scoreboard/app run build && yarn workspace @scoreboard/server run build",
    "start": "yarn workspace @scoreboard/server run start"
  },
  "packageManager": "yarn@4.9.2+sha512.1fc009bc09d13cfd0e19efa44cbfc2b9cf6ca61482725eb35bbc5e257e093ebf4130db6dfe15d604ff4b79efd8e1e8e99b25fa7d0a6197c9f9826358d4d65c3c"
}
```

**Step 5: Update `.gitignore`** to add standard entries:

```gitignore
node_modules
dist
.DS_Store
*.log
.yarn/*
!.yarn/cache
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/sdks
!.yarn/versions
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo structure with packages/server"
```

---

### Task 2: Import flash-score-app as packages/app

**Files:**
- Create: `packages/app/` (copy from `../flash-score-app`)
- Modify: `packages/app/package.json` (rename, update build script)
- Modify: `packages/app/vite.config.ts` (update outDir)

**Step 1: Copy flash-score-app into packages/app**

```bash
cp -r ../flash-score-app packages/app
rm -rf packages/app/.git packages/app/node_modules packages/app/dist packages/app/.yarn packages/app/.idea packages/app/yarn.lock packages/app/package-lock.json packages/app/bun.lockb
```

**Step 2: Update `packages/app/package.json`**

Change the name and build script:
- `"name"` → `"@scoreboard/app"`
- `"build"` script → `"vite build"` (remove rsync, Vite outDir handles it)
- Remove the `packageManager` field (inherited from root)

**Step 3: Update `packages/app/vite.config.ts`**

Add `build.outDir` pointing to the server's public/admin/ and `build.emptyOutDir: true`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  base: "/admin/",
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../server/public/admin"),
    emptyOutDir: true,
  },
}));
```

**Step 4: Run `yarn install` from root to set up workspaces**

```bash
yarn install
```

**Step 5: Verify the app builds**

```bash
yarn workspace @scoreboard/app run build
```

Expected: Build succeeds, output appears in `packages/server/public/admin/`.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: import flash-score-app as packages/app"
```

---

## Phase 2: TypeScript Migration of Server

### Task 3: Create TypeScript config files

**Files:**
- Create: `tsconfig.base.json` (root)
- Create: `packages/server/tsconfig.json`

**Step 1: Create `tsconfig.base.json` at root**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 2: Create `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Commit**

```bash
git add tsconfig.base.json packages/server/tsconfig.json
git commit -m "chore: add TypeScript configuration for server"
```

---

### Task 4: Create `packages/server/src/types.ts`

**Files:**
- Create: `packages/server/src/types.ts`

**Step 1: Write types file**

```typescript
import type { Socket } from "socket.io";

export interface ScoreboardState {
  rev?: string;
  endDate?: number;
  remaining?: number;
  paused?: boolean;
  [key: string]: unknown;
}

export interface PowerCommand {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bearer?: string;
  body?: unknown;
}

export type ScoreboardSockets = Record<string, Socket[]>;
export type StateMap = Record<string, ScoreboardState>;

export interface UpdateMessage {
  rev?: string;
  remaining?: number;
  paused?: boolean;
  [key: string]: unknown;
}

export interface PowerMessage {
  turnOn?: boolean;
  turnOff?: boolean;
  mode?: "score" | "off" | "signage";
}

export interface ForwardResult {
  status: number;
  rev?: string;
  response?: unknown;
}
```

**Step 2: Commit**

```bash
git add packages/server/src/types.ts
git commit -m "feat: add TypeScript type definitions for server"
```

---

### Task 5: Create `packages/server/src/config.ts`

**Files:**
- Create: `packages/server/src/config.ts`

**Step 1: Write config file**

```typescript
export const PORT = Number(process.env.PORT) || 5000;

const rawCorsOrigin = process.env.CORS_ORIGIN || "*";
export const CORS_ORIGIN =
  rawCorsOrigin === "*" ? "*" : rawCorsOrigin.split(",").map((s) => s.trim());

export const GDS_SECRET = process.env.GDS_SECRET || "Secret";

export const validateToken = (token: string): boolean => GDS_SECRET === token;
```

**Step 2: Commit**

```bash
git add packages/server/src/config.ts
git commit -m "feat: add server config module"
```

---

### Task 6: Create `packages/server/src/state.ts`

**Files:**
- Create: `packages/server/src/state.ts`

**Step 1: Write state module**

```typescript
import type { Socket } from "socket.io";
import type {
  ScoreboardSockets,
  StateMap,
  ForwardResult,
} from "./types.js";
import { validateToken } from "./config.js";

export const scoreBoards: ScoreboardSockets = {};
export const state: StateMap = {};

export function forward(
  action: string,
  uuid: string,
  token: string,
  callback: (result: ForwardResult) => void,
  msg?: Record<string, unknown>
): void {
  if (validateToken(token)) {
    console.log(
      `Forwarding: ${uuid}, ${action}${msg ? " < " + JSON.stringify(msg) : ""}`
    );
    if (scoreBoards[uuid] && scoreBoards[uuid].length) {
      scoreBoards[uuid].forEach((s) => {
        s.emit(
          action,
          { ts: Date.now(), rev: state[uuid].rev, ...(msg || {}) },
          (response: unknown) => {
            callback({ status: 200, rev: state[uuid].rev, response });
          }
        );
      });
    } else {
      callback({ status: 404 });
    }
  } else {
    callback({ status: 401 });
  }
}

export function register(
  token: string,
  uuid: string,
  socket: Socket,
  uuids: string[]
): boolean {
  if (validateToken(token)) {
    console.log(`Registering: ${uuid}`);
    scoreBoards[uuid] = (scoreBoards[uuid] || []).concat([socket]);
    if (!state[uuid]) {
      state[uuid] = {};
    }
    uuids.push(uuid);
    return true;
  } else {
    console.log(`Registering: ${uuid} failed due to incorrect token`);
    return false;
  }
}
```

**Step 2: Commit**

```bash
git add packages/server/src/state.ts
git commit -m "feat: add server state management module"
```

---

### Task 7: Create `packages/server/src/socket.ts`

**Files:**
- Create: `packages/server/src/socket.ts`

**Step 1: Write socket handlers**

```typescript
import type { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { validateToken } from "./config.js";
import { scoreBoards, state, forward, register } from "./state.js";
import type { PowerCommand, PowerMessage, UpdateMessage } from "./types.js";

async function doPowerRequest(envVarKey: string): Promise<{ status: number }> {
  const command = process.env[envVarKey];
  if (!command) return { status: 404 };

  let parsedCommand: PowerCommand;
  try {
    parsedCommand = JSON.parse(command);
  } catch (e) {
    console.error("Invalid JSON for", envVarKey, e);
    return { status: 400 };
  }
  if (!parsedCommand?.url) return { status: 400 };

  const headers: Record<string, string> = {
    ...(!parsedCommand.headers
      ? { "Content-Type": "application/json" }
      : parsedCommand.headers),
  };
  if (
    parsedCommand.bearer &&
    !headers.Authorization &&
    !headers.authorization
  ) {
    headers.Authorization = `Bearer ${parsedCommand.bearer}`;
  }

  const body =
    parsedCommand.body !== undefined
      ? typeof parsedCommand.body === "string"
        ? parsedCommand.body
        : JSON.stringify(parsedCommand.body)
      : undefined;

  try {
    const res = await fetch(parsedCommand.url, {
      method: parsedCommand.method || "GET",
      headers,
      body,
    });
    if (res.ok) {
      const text = await res.text();
      console.log(
        `Power request to ${parsedCommand.url} succeeded with response:`,
        text
      );
      return { status: 200 };
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(err);
    return { status: 400 };
  }
}

export function setupSocketHandlers(io: Server): void {
  io.on("connection", (socket) => {
    const uuids: string[] = [];

    console.log("client connected");

    const uuid = socket.handshake.query.uuid as string;
    const token = socket.handshake.query.token as string;

    if (socket.handshake.query?.token) {
      if (!register(token, uuid, socket, uuids)) {
        socket.disconnect(true);
        return;
      }
    }

    socket.on("update", ({ rev, ...msg }: UpdateMessage, callback) => {
      if (!state[uuid]) {
        callback?.({ status: 403 });
        return;
      }
      if (!state[uuid].rev || rev === state[uuid].rev) {
        state[uuid] = {
          ...state[uuid],
          ...msg,
          ...(msg.remaining
            ? {
                endDate: Date.now() + msg.remaining * 1000,
                remaining: msg.remaining,
              }
            : msg.paused && !state[uuid].paused && state[uuid].endDate
              ? {
                  remaining: Math.floor(
                    (state[uuid].endDate! - Date.now()) / 1000
                  ),
                }
              : {}),
          rev: uuidv4(),
        };
        console.log("states is", state[uuid]);
        forward("update", uuid, token, callback, msg as Record<string, unknown>);
      } else {
        callback?.({ status: 409 });
      }
    });

    socket.on("power", ({ turnOn, turnOff, mode }: PowerMessage, callback) => {
      if (state[uuid]) {
        const sanitizedUuid = uuid.replace(/-/g, "_");
        const promises: Promise<{ status: number }>[] = [];

        if (mode) {
          if (mode === "score")
            promises.push(doPowerRequest(`POWER_ON_URL_${sanitizedUuid}`));
          if (mode === "off")
            promises.push(doPowerRequest(`POWER_OFF_URL_${sanitizedUuid}`));
          if (mode === "signage")
            promises.push(doPowerRequest(`SIGNAGE_URL_${sanitizedUuid}`));
        } else {
          if (turnOn)
            promises.push(doPowerRequest(`POWER_ON_URL_${sanitizedUuid}`));
          if (turnOff)
            promises.push(doPowerRequest(`POWER_OFF_URL_${sanitizedUuid}`));
        }

        Promise.all(promises).then((results) => {
          if (!results.length) {
            callback?.({ status: 404 });
            return;
          }
          const ok = results.some((r) => r?.status === 200);
          callback?.({
            status: ok ? 200 : results[0]?.status || 400,
          });
        });
      }
      console.log("states is", state[uuid]);
    });

    socket.on("ping", () => {});

    socket.on("sync", (_data: Record<string, never>, callback) => {
      if (validateToken(token) && state[uuid]) {
        callback?.({
          status: 200,
          resp: {
            ...state[uuid],
            remaining:
              state[uuid].paused && state[uuid].remaining
                ? state[uuid].remaining
                : state[uuid].endDate
                  ? Math.floor((state[uuid].endDate! - Date.now()) / 1000)
                  : undefined,
            endDate: undefined,
          },
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("client disconnected");
      uuids.forEach((id) => {
        scoreBoards[id] = (scoreBoards[id] || []).filter((x) => x !== socket);
      });
    });
  });
}
```

**Step 2: Commit**

```bash
git add packages/server/src/socket.ts
git commit -m "feat: add socket.io handlers module"
```

---

### Task 8: Create `packages/server/src/server.ts` and `packages/server/src/index.ts`

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/index.ts`
- Delete: `packages/server/index.js`

**Step 1: Write `server.ts`**

```typescript
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { CORS_ORIGIN } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const corsOptions = {
  origin: CORS_ORIGIN,
  credentials: true,
};

export const app = express();
app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, "../public")));
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "../public/index.html"))
);

export { corsOptions };
```

**Step 2: Write `index.ts`**

```typescript
import http from "http";
import { Server } from "socket.io";
import { app, corsOptions } from "./server.js";
import { setupSocketHandlers } from "./socket.js";
import { PORT, GDS_SECRET } from "./config.js";

console.log(`Secret is set to ${GDS_SECRET}`);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOptions.origin, credentials: corsOptions.credentials },
});

setupSocketHandlers(io);

server.listen(PORT, () => {
  console.log("listening on *:" + PORT);
});
```

**Step 3: Delete old `index.js`**

```bash
rm packages/server/index.js
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete TypeScript migration of server"
```

---

## Phase 3: Install, Verify, Clean Up

### Task 9: Install dependencies and verify everything works

**Step 1: Install all workspace dependencies from root**

```bash
yarn install
```

**Step 2: Verify server starts in dev mode**

```bash
yarn workspace @scoreboard/server run dev
```

Expected: Server starts on port 5000 with "listening on *:5000" output. Stop with Ctrl+C.

**Step 3: Verify server compiles for production**

```bash
yarn workspace @scoreboard/server run build
```

Expected: `packages/server/dist/` contains compiled JS files.

**Step 4: Verify app builds**

```bash
yarn workspace @scoreboard/app run build
```

Expected: Build output in `packages/server/public/admin/`.

**Step 5: Verify root scripts work**

```bash
yarn build
yarn start
```

Expected: Server starts and serves both the display page and admin app.

**Step 6: Commit any fixes needed, then final commit**

```bash
git add -A
git commit -m "chore: verify monorepo builds and runs correctly"
```

---

### Task 10: Clean up and update documentation

**Files:**
- Delete: `packages/server/yarn-error.log` (if present)
- Modify: `packages/app/CLAUDE.md` (update paths)
- Create: `CLAUDE.md` (root-level project guidance)

**Step 1: Remove stale files**

```bash
rm -f packages/server/yarn-error.log
```

**Step 2: Update `packages/app/CLAUDE.md`**

Update the build command description to reflect that rsync is no longer used. Update any references to `../scoreboard-server` since the app is now a sibling package.

**Step 3: Create root `CLAUDE.md`**

```markdown
# CLAUDE.md

## Project Overview

Scoreboard monorepo: a real-time sports scoreboard system with an Express+Socket.IO server and a React admin interface.

## Structure

- `packages/server/` — Express + Socket.IO backend (TypeScript)
- `packages/app/` — React admin interface (TypeScript, Vite, shadcn/ui)

## Commands

- `yarn dev` — Start both server and app in dev mode
- `yarn build` — Build app then compile server
- `yarn start` — Run compiled server in production
- `yarn workspace @scoreboard/server run dev` — Server only
- `yarn workspace @scoreboard/app run dev` — App only

## Tech Stack

- Yarn 4 workspaces (Corepack)
- Server: Express, Socket.IO, TypeScript, tsx (dev)
- App: React 18, Vite (SWC), shadcn/ui, Tailwind CSS, Socket.IO client

## Key Files

- `packages/server/src/index.ts` — Server entry point
- `packages/server/src/socket.ts` — Socket.IO event handlers
- `packages/server/src/state.ts` — Scoreboard state management
- `packages/app/src/pages/Index.tsx` — App main page with state management
```

**Step 4: Commit**

```bash
git add -A
git commit -m "docs: add root CLAUDE.md and clean up"
```
