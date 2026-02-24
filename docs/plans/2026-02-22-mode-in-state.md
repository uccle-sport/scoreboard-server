# Mode in Scoreboard State — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist the display mode (`score` | `off` | `signage`) in server-side state so it survives reconnects and is shared across all connected admin clients.

**Architecture:** The server's `power` handler already receives `mode` but discards it after firing HTTP requests. We write it to `state[uuid]` so `sync` returns it automatically (since sync spreads the full state). The app lifts `activeMode` from local component state to `Index.tsx`, reads it from sync/update responses, and passes it down as a prop.

**Tech Stack:** TypeScript, Express, Socket.IO 4, React 18, Vite

---

### Task 1: Add `mode` to server types and persist it in the power handler

**Files:**
- Modify: `packages/server/src/types.ts` (add `mode` field)
- Modify: `packages/server/src/socket.ts:107-138` (persist mode in state)

**Step 1: Add `mode` to `ScoreboardState` in `packages/server/src/types.ts`**

The `ScoreboardState` interface currently has no `mode` field. Add it explicitly so TypeScript knows it's a first-class field (rather than slipping through `[key: string]: unknown`):

```typescript
export interface ScoreboardState {
  rev?: string;
  endDate?: number;
  remaining?: number;
  paused?: boolean;
  mode?: "score" | "off" | "signage";   // ← add this line
  [key: string]: unknown;
}
```

**Step 2: Persist mode in the `power` handler in `packages/server/src/socket.ts`**

Find the `socket.on("power", ...)` handler (line ~107). After `if (state[uuid]) {`, add a block that resolves and stores the mode **before** the HTTP requests fire. Replace the existing handler body with:

```typescript
socket.on("power", ({ turnOn, turnOff, mode }: PowerMessage, callback) => {
  if (state[uuid]) {
    // Persist the mode in state so sync returns it
    const resolvedMode: "score" | "off" | "signage" | undefined =
      mode ?? (turnOn ? "score" : turnOff ? "off" : undefined);
    if (resolvedMode) {
      state[uuid] = { ...state[uuid], mode: resolvedMode };
    }

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
```

**Step 3: Verify the server still compiles**

```bash
yarn workspace @scoreboard/server run build
```

Expected: no TypeScript errors, `dist/` updated.

**Step 4: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/socket.ts
git commit -m "feat: persist mode in scoreboard state"
```

---

### Task 2: Lift `activeMode` to `Index.tsx` and read it from server state

**Files:**
- Modify: `packages/app/src/pages/Index.tsx` (add mode state, read from sync/update)
- Modify: `packages/app/src/components/SettingsScreen.tsx` (accept mode as prop)

**Step 1: Add `mode` to the `Message` interface in `packages/app/src/pages/Index.tsx`**

The `Message` interface (line 8) describes the payload from `update` events. Add the field:

```typescript
interface Message {
    rev: string;
    home: number;
    away: number;
    remaining?: number;
    paused: boolean;
    period?: string;
    homeTeam?: string;
    awayTeam?: string;
    mode?: "score" | "off" | "signage";   // ← add this line
}
```

**Step 2: Add `activeMode` state to `Index.tsx`**

After the existing `useState` declarations (around line 31), add:

```typescript
const [activeMode, setActiveMode] = useState<"score" | "off" | "signage">("off");
```

**Step 3: Apply mode in `onUpdate`**

`onUpdate` (line ~85) handles incoming `update` broadcasts. Add mode handling at the end of the function:

```typescript
const onUpdate = (msg: Message) => {
    setLatestRev(msg.rev);
    setHomeScore(msg.home);
    setAwayScore(msg.away);
    setPaused(msg.paused);
    setPeriod(msg.period || "1st Quarter");
    if (msg.homeTeam) setHomeTeam(msg.homeTeam);
    if (msg.awayTeam) setAwayTeam(msg.awayTeam);
    if (msg.remaining !== undefined) {
        setRemaining(Math.max(0, msg.remaining));
        setEndDate(new Date(Date.now() + Math.max(0, msg.remaining) * 1000));
    }
    if (msg.mode) setActiveMode(msg.mode);   // ← add this line
};
```

**Step 4: Read mode from `sync` response**

In the `sync` callback inside `useEffect` (line ~108), the `onUpdate(resp)` call already runs — but `onUpdate` only sets mode `if (msg.mode)`, which covers the case when mode is in the sync response. No additional change needed here.

**Step 5: Update `handleActiveChange` to also update local mode state**

Currently `handleActiveChange` only emits to the socket. Update it so the local button reflects immediately without waiting for a broadcast:

```typescript
const handleActiveChange = (val: "score" | "signage" | "off") => {
    setActiveMode(val);   // ← add this line
    socket.emit('power', {turnOn: val !== "off", turnOff: val === "off", mode: val});
};
```

**Step 6: Pass `activeMode` as prop and remove it from `SettingsScreen`**

In the JSX (line ~182), pass the new prop:

```tsx
<SettingsScreen
    homeTeam={homeTeam}
    awayTeam={awayTeam}
    onHomeTeamChange={handleHomeTeamChange}
    onAwayTeamChange={handleAwayTeamChange}
    onActiveChange={handleActiveChange}
    activeMode={activeMode}           // ← add this line
/>
```

**Step 7: Update `SettingsScreen.tsx` to accept `activeMode` as a prop**

In `packages/app/src/components/SettingsScreen.tsx`:

1. Add `activeMode` to the props interface:

```typescript
interface SettingsScreenProps {
  homeTeam: string;
  awayTeam: string;
  onHomeTeamChange: (name: string) => void;
  onAwayTeamChange: (name: string) => void;
  onActiveChange: (mode: "score" | "signage" | "off") => void;
  activeMode: "score" | "off" | "signage";   // ← add this line
}
```

2. Accept `activeMode` in the destructured props (replace the `const [activeMode, setActiveMode]` local state):

```typescript
const SettingsScreen = ({
  homeTeam,
  awayTeam,
  onHomeTeamChange,
  onAwayTeamChange,
  onActiveChange,
  activeMode,           // ← add this, remove the useState below
}: SettingsScreenProps) => {
  // DELETE: const [activeMode, setActiveMode] = useState<"score" | "signage" | "off">("off");
  const appUrl = window.location.href;
```

3. Update `handleModeChange` to only call the parent (remove `setActiveMode`):

```typescript
const handleModeChange = (mode: "score" | "signage" | "off") => {
    onActiveChange(mode);   // remove: setActiveMode(mode)
};
```

**Step 8: Verify the app builds**

```bash
yarn workspace @scoreboard/app run build
```

Expected: no TypeScript errors, build output in `packages/server/public/admin/`.

**Step 9: Commit**

```bash
git add packages/app/src/pages/Index.tsx packages/app/src/components/SettingsScreen.tsx
git commit -m "feat: sync activeMode from server state in admin app"
```
