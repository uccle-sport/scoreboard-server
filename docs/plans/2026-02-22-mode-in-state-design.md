# Mode in Scoreboard State — Design

**Date:** 2026-02-22

## Problem

The `power` event handler fires HTTP requests for mode changes but never writes the mode to `state[uuid]`. As a result:
- `sync` responses never include the current mode
- A second admin app opening always shows "off" regardless of actual mode
- Mode is only tracked as transient local UI state in `SettingsScreen`

## Solution

### Server (`packages/server`)

1. **`src/types.ts`** — Add `mode?: "score" | "off" | "signage"` to `ScoreboardState`
2. **`src/socket.ts`** — In the `power` handler, before firing HTTP requests, write the resolved mode to `state[uuid].mode`. Since `sync` already spreads all of `state[uuid]`, mode is transmitted automatically with no further changes.

### App (`packages/app`)

3. **`src/pages/Index.tsx`** — Lift `activeMode` state up from `SettingsScreen`. Initialize it from `resp.mode` in the `sync` callback and update it in `onUpdate` when an incoming broadcast includes a mode change.
4. **`src/components/SettingsScreen.tsx`** — Accept `activeMode` as a prop instead of managing its own `useState`. No UI changes.

## Data Flow

```
power event → server saves state[uuid].mode
sync response → includes mode → app sets activeMode
update broadcast → includes mode → all admins update activeMode
```
