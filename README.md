# Scoreboard

A real-time sports scoreboard system for live hockey events. An operator uses the **admin app** on a phone or tablet to control scores and a countdown timer; the **display app** renders the live scoreboard on a big screen or projector, updating instantly via WebSockets.

```
┌─────────────────┐        Socket.IO         ┌──────────────────┐
│   Admin App     │ ──── update/sync ──────► │    Server        │
│ (React PWA)     │ ◄─── broadcast ───────── │ (Express+Socket) │
└─────────────────┘                          └────────┬─────────┘
                                                      │ serves
                                             ┌────────▼─────────┐
                                             │  Display App     │
                                             │  (React, port /) │
                                             └──────────────────┘
                                                      ▲
                                                      │ Socket.IO
                                             ┌────────┴─────────┐
                                             │  Display Client  │
                                             │  (big screen)    │
                                             └──────────────────┘
```

---

## Repository Structure

This is a **Bun workspaces monorepo** with three packages:

```
scoreboard-server/
├── packages/
│   ├── server/          # Express + Socket.IO backend (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts     # Entry point
│   │   │   ├── server.ts    # Express app, static file serving
│   │   │   ├── socket.ts    # Socket.IO event handlers
│   │   │   ├── state.ts     # In-memory scoreboard state
│   │   │   ├── config.ts    # Environment variables
│   │   │   └── types.ts     # Shared TypeScript interfaces
│   │   └── public/          # Static files served by Express (generated)
│   │       ├── index.html   # Display app entry (built by packages/display)
│   │       └── admin/       # Admin app (built by packages/app)
│   ├── app/             # React admin interface (TypeScript + Vite)
│   │   └── src/
│   │       ├── pages/Index.tsx         # All scoreboard state lives here
│   │       ├── hooks/use-socket.tsx    # Socket.IO singleton
│   │       └── components/
│   │           ├── ScoreboardScreen.tsx
│   │           └── SettingsScreen.tsx
│   └── display/         # React big-screen display app (TypeScript + Vite)
│       └── src/
│           └── components/
│               └── Scoreboard.tsx      # Full-screen scoreboard display
├── tsconfig.base.json   # Shared TypeScript config
├── package.json         # Workspace root
└── CLAUDE.md            # Guidance for AI assistants
```

---

## Prerequisites

| Tool | Version          | Notes                                          |
|------|------------------|------------------------------------------------|
| Bun  | v1.2+ (1.3 used) | Runtime, package manager, and script runner    |

Install Bun (once, system-wide):

```bash
curl -fsSL https://bun.sh/install | bash
```

---

## Getting Started

```bash
# Clone the repository
git clone <repo-url>
cd scoreboard-server

# Install all dependencies (all packages at once)
bun install
```

### Running in Development

```bash
# Start all three packages in dev mode simultaneously
bun run dev
```

- **Server** runs on `http://localhost:5000` (auto-restarts on file changes via `bun --watch`)
- **Admin app** dev server runs on `http://localhost:8080/admin/`
- **Display app** dev server runs on `http://localhost:8081/`

To run each package individually:

```bash
bun run --filter @scoreboard/server dev    # server only
bun run --filter @scoreboard/app dev       # admin app only (port 8080)
bun run --filter @scoreboard/display dev   # display app only (port 8081)
```

### Opening the Admin App in Development

Navigate to:
```
http://localhost:8080/admin/?uuid=<your-scoreboard-uuid>&secret=Secret
```

- `uuid` — a UUID identifying the scoreboard (create any UUID, e.g. `11111111-1111-1111-1111-111111111111` for local dev)
- `secret` — must match the server's `GDS_SECRET` env var (default: `Secret`)

### Opening the Display App

In development the display app has its own dev server:

```
http://localhost:8081/?uuid=<your-scoreboard-uuid>&secret=Secret
```

In production (after `bun run build`) it is served by the Express server at:

```
http://localhost:5000/?uuid=<your-scoreboard-uuid>&secret=Secret
```

Changes made in the admin app appear here in real time.

---

## Building for Production

```bash
# Build the frontends in order, then type-check the server
bun run build
```

This runs three steps in order:
1. `vite build` in `packages/display/` → wipes `packages/server/public/` and outputs the display app
2. `vite build` in `packages/app/` → outputs to `packages/server/public/admin/` (preserves display output)
3. `tsc --noEmit` in `packages/server/` → type-checks the server (Bun runs the `.ts` sources directly, so there is no compile-to-`dist` step)

The build order matters: the display build uses `emptyOutDir: true` to clear stale hashed assets, and the app build runs after to restore `public/admin/`.

```bash
# Start the server (Bun runs the TypeScript entry point directly)
bun run start
```

---

## Docker

The repo-root `Dockerfile` builds a self-contained server image. It is a multi-stage
build that compiles both frontends into `packages/server/public`, then runs the
server with Bun on an `alpine-glibc` base with the Bun binary copied in.

```bash
# Build from the repository root (the context must include all workspaces)
docker build -t scoreboard-server .

# Run it
docker run -p 5000:5000 -e GDS_SECRET=your-secret scoreboard-server
```

The image serves the display app at `/`, the admin app at `/admin/`, and the
Socket.IO/API endpoints — all on `PORT` (default `5000`).

---

## Environment Variables

All variables are optional; defaults are shown.

| Variable               | Default  | Description                                         |
|------------------------|----------|-----------------------------------------------------|
| `PORT`                 | `5000`   | Port the server listens on                          |
| `GDS_SECRET`           | `Secret` | Shared secret for authenticating clients            |
| `CORS_ORIGIN`          | `*`      | Allowed CORS origin(s), comma-separated             |
| `FLOWR_BEARER`             | —        | Bearer token injected into every Flowr request (webhooks, channel search, logo proxy) |
| `FLOWR_LOGO_URL_TEMPLATE`  | —        | Logo image URL template (`{logo}` = numeric view id), used by the `/channel-logo` proxy |
| `POWER_ON_URL_<UUID>`      | —        | JSON config for powering a display on by UUID                       |
| `POWER_OFF_URL_<UUID>`     | —        | JSON config for powering a display off by UUID                      |
| `SCOREBOARD_URL_<UUID>`    | —        | JSON config for switching a display's source to the scoreboard      |
| `TV_URL_<UUID>`            | —        | JSON config for switching a display's source to TV (supports `{channel}`)      |
| `SIGNAGE_URL_<UUID>`       | —        | JSON config for switching a display's source to signage (supports `{channel}`) |
| `VOLUME_URL_<UUID>`        | —        | JSON config for setting the volume of the current channel (uses `message.volume`) |
| `TV_CHANNELS_<UUID>`       | `[]`     | JSON request config for loading selectable TV channels       |
| `SIGNAGE_CHANNELS_<UUID>`  | `[]`     | JSON request config for loading selectable signage channels  |

The UUID env vars use underscores in place of hyphens (e.g., for UUID `abc-123`, the var name is `POWER_ON_URL_abc_123`).

### Power / Display Control Config Format

The power and display URL vars accept a JSON string describing the request the
server sends to the device controller (Flowr). The `{channel}` placeholder inside
`body.message.route` is replaced with the URL-encoded channel id when switching to
`tv` or `signage`; it is left untouched for power on/off and scoreboard requests,
which receive no channel. The requested volume (0..100, from the `display` or
`volume` event) is written into `body.message.volume` when provided. The bearer is
injected from `FLOWR_BEARER` — do not embed it in the config.

```json
{
  "url": "https://device-controller/api/send",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": {
    "devices": ["device-uuid"],
    "message": { "type": "PLAY", "route": "{channel}", "volume": null, "lang": "en" },
    "shouldBeAcknowledged": true,
    "shouldWakeUpDevice": true
  }
}
```

### Channel List Config Format

`TV_CHANNELS_<UUID>` / `SIGNAGE_CHANNELS_<UUID>` hold a JSON request config used to
fetch the list of selectable channels from the Flowr channel-search API. The server
POSTs the request (bearer injected from `FLOWR_BEARER`), then maps each result to
`{ id: channelUuid, label: name, imageUrl? }`. `channelType` optionally filters
results. Each `imageUrl` points at the server's **`/channel-logo/<logo>` proxy**,
which rebuilds the Flowr image URL from `FLOWR_LOGO_URL_TEMPLATE` and fetches it with
the bearer attached — the browser `<img>` can't send the `Authorization` header, so a
direct Flowr URL would `403`.

```json
{
  "url": "https://sportlab.flowr.cloud/ozone/rest/v3/items/channel/search",
  "method": "POST",
  "channelType": "tv",
  "body": {
    "query": {
      "$type": "BoolQuery",
      "mustClauses": [
        { "$type": "TenantQuery", "tenantId": "…", "mode": "OWN_AND_PARENTS" },
        { "$type": "TermsQuery", "field": "packages", "values": ["…"] }
      ]
    },
    "offset": 0,
    "sorts": [],
    "size": 100
  }
}
```

---

## Architecture Deep Dive

### State Model

The server holds an in-memory `state` map keyed by scoreboard UUID. Each entry is a `ScoreboardState`:

```typescript
interface ScoreboardState {
  rev?: string;       // UUID updated on every change (optimistic concurrency)
  paused?: boolean;
  remaining?: number; // seconds remaining on clock
  endDate?: number;   // epoch ms when clock will reach zero (derived when running)
  power?: "on" | "off";                          // physical screen power
  display?: "scoreboard" | "tv" | "signage";     // active content source
  channel?: string;                              // selected tv/signage channel id
  volume?: number;                               // channel volume (0..100)
  [key: string]: unknown; // score, team names, period, etc.
}
```

### Optimistic Concurrency (`rev`)

Every state update carries the `rev` the client last saw. If the server's current `rev` differs, it returns HTTP 409 and the client re-syncs. This prevents stale updates from overwriting newer ones when multiple clients are connected.

### Socket.IO Events

| Event        | Direction                 | Description                                                   |
|--------------|---------------------------|---------------------------------------------------------------|
| `update`     | client → server → clients | Send a state change; server broadcasts to all display clients |
| `sync`       | client → server           | Request full current state + channel lists (used after a 409) |
| `power`      | client → server           | Turn the physical display on/off (`{ on: boolean }`)          |
| `display`    | client → server           | Select content source + channel, optional volume (`{ display, channel?, volume? }`) |
| `volume`     | client → server           | Set the current channel's volume 0..100 (`{ volume }`)        |
| `ping`       | client → server           | Keep-alive                                                    |
| `disconnect` | —                         | Server removes the socket from the scoreboard's client list   |

### Timer Logic

The countdown timer lives **entirely in the client** (admin app). When running:
- `remaining` is derived as `Math.floor((endDate - Date.now()) / 1000)`
- `endDate` is stored server-side so newly connected display clients can compute the correct remaining time

When paused:
- `remaining` is stored explicitly; `endDate` is cleared

### URL Parameters

Both client apps read configuration from query params at load time.

**Admin app** (`/admin/`):

| Param           | Required | Description                                              |
|-----------------|----------|----------------------------------------------------------|
| `uuid`          | yes      | Scoreboard UUID to manage                                |
| `secret`        | yes      | Authentication token (`GDS_SECRET`)                      |
| `socket-io-url` | no       | Override server URL (useful if app is hosted separately) |

**Display app** (`/`):

| Param           | Required | Description                         |
|-----------------|----------|-------------------------------------|
| `uuid`          | yes      | Scoreboard UUID to display          |
| `secret`        | yes      | Authentication token (`GDS_SECRET`) |
| `socket-io-url` | no       | Override server URL                 |

---

## Tech Stack

### Server (`packages/server`)

|            |                                                     |
|------------|-----------------------------------------------------|
| Runtime    | Bun (ESM)                                           |
| Framework  | Express 4                                           |
| Real-time  | Socket.IO 4.8                                       |
| Language   | TypeScript 5, run directly by Bun (no compile step) |
| Type-check | `tsc --noEmit`                                      |
| Dev runner | `bun --watch` (auto-restart on file changes)        |

### App (`packages/app`)

|           |                                     |
|-----------|-------------------------------------|
| Framework | React 18                            |
| Language  | TypeScript 5                        |
| Build     | Vite 5 + SWC                        |
| UI        | shadcn/ui + Radix UI + Tailwind CSS |
| Icons     | Lucide React                        |
| Forms     | React Hook Form + Zod               |
| Real-time | Socket.IO client 4.8                |

### Display (`packages/display`)

|           |                          |
|-----------|--------------------------|
| Framework | React 18                 |
| Language  | TypeScript 5             |
| Build     | Vite 5 + SWC             |
| UI        | shadcn/ui + Tailwind CSS |
| Real-time | Socket.IO client         |
| Dev port  | 8081                     |

---

## Making Changes

### Server changes

Edit files in `packages/server/src/`. With `bun run dev` running, `bun --watch` restarts the server automatically.

Key files:

- **Add a new Socket.IO event** → `packages/server/src/socket.ts`
- **Change state shape** → `packages/server/src/types.ts`, then update `packages/server/src/state.ts`
- **Add an env var** → `packages/server/src/config.ts`

### App changes

Edit files in `packages/app/src/`. Vite HMR updates the browser instantly.

Key files:

- **Scoreboard controls** (score buttons, timer, period) → `packages/app/src/components/ScoreboardScreen.tsx`
- **Settings** (team names, power toggle, QR code) → `packages/app/src/components/SettingsScreen.tsx`
- **All state + Socket.IO glue** → `packages/app/src/pages/Index.tsx`
- **Socket singleton** → `packages/app/src/hooks/use-socket.tsx`
- **Add a shadcn/ui component** → `bunx shadcn-ui@latest add <component>` in `packages/app/`

### Display app changes

Edit files in `packages/display/src/`. Vite HMR updates the browser instantly on the display dev server (`http://localhost:8081/`).

Key files:

- **Scoreboard layout and rendering** → `packages/display/src/components/Scoreboard.tsx`
- **Socket.IO connection and state sync** → also in `Scoreboard.tsx` (single-component app)

The display app URL params (`uuid`, `secret`, `socket-io-url`) are read from `window.location.search` at load time.

---

## Common Workflows

### Reset scores without restarting the server

The server state is in-memory. Restart the server or send a new `update` event with zeroed scores from the admin app.

### Connect to a remote server from local admin dev

Add `?socket-io-url=https://your-server.example.com` to the admin URL:

```
http://localhost:8080/admin/?uuid=...&secret=...&socket-io-url=https://your-server.example.com
```

### Deploy

The simplest path is the Docker image (see [Docker](#docker) above).

To deploy without Docker:

1. `bun run build` — populates `packages/server/public/` (display app at `/`, admin app at `/admin/`)
2. Copy the repo to your host (excluding `node_modules`)
3. Run `bun install --production` on the host, then `bun run --filter @scoreboard/server start`

Or use the `bun run start` script from the monorepo root.

---

## Troubleshooting

**Admin app can't connect to server**
- Check that the server is running (`bun run --filter @scoreboard/server dev`)
- Verify `uuid` and `secret` query params match what the server expects
- Check browser console for WebSocket errors

**409 errors on update**
- Expected behaviour: the server has a newer state than your client. The app automatically re-syncs on 409.

**Port 5000 already in use**
- Set `PORT=5001` (or any free port) in your environment before starting the server

**TypeScript errors after pulling**
- Run `bun install` to ensure dependencies are up to date, then `bun run --filter @scoreboard/server build`
