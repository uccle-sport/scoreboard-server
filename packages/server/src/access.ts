// Who may change what, per scoreboard.
//
// `GDS_SECRET` gets a socket connected and reading; every mutating handler
// additionally needs a grant recorded here, obtained by entering an 8-digit PIN.
// Three PIN namespaces exist, in descending privilege:
//
//   * protected-slot PINs (`PROTECTED_SLOTS_<UUID>`) — master keys, valid at any
//     time, and the only way to edit during a protected slot;
//   * source PINs (`TV_PINS_<UUID>`, `SIGNAGE_PINS_<UUID>`) — unlock TV /
//     Signage switching for one phone, and nothing else;
//   * the temporary PIN the server mints when a phone claims an unowned
//     scoreboard, shareable with other phones for simultaneous control.
//
// None of this lives in `ScoreboardState`: that type has an index signature and
// the `update` handler spreads client input straight into it, so a PIN stored
// there would be both writable and readable by any connected phone.
//
// There is no timer. Expiry is evaluated on read by `sweep`, the same lazy
// pattern the channel cache in socket.ts already uses.
import { randomInt } from "node:crypto";
import { CONTROL_TTL_MS, SOURCE_GRANT_TTL_MS } from "./config.js";
import { envFor } from "./env-keys.js";
import { activeSlot, nextBoundary, slotEnd, slotsFor } from "./slots.js";
import type {
  AccessRecord,
  AccessStateWire,
  Capability,
  ParsedSlot,
} from "./types.js";

const PIN_RE = /^\d{8}$/;

// Wrong-PIN budget. Generous enough that a mistyped digit never locks out a
// scorer mid-match, tight enough that grinding 10^8 over a socket is hopeless.
const MAX_FAILURES = 5;
const LOCKOUT_BASE_MS = 60_000;
const LOCKOUT_MAX_MS = 15 * 60_000;

const access: Record<string, AccessRecord> = {};

export interface AccessResult {
  status: number;
  retryAfter?: number;
}

// Test hook: the map is module state, so suites must be able to start clean.
export function resetAccess(): void {
  for (const key of Object.keys(access)) delete access[key];
}

// Accepts either a JSON array or a comma/space-separated list, so a single PIN
// needs no JSON punctuation in .env. Only 8-digit entries survive.
function parsePinList(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  let candidates: unknown[];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      candidates = Array.isArray(parsed) ? parsed : [];
      if (!Array.isArray(parsed)) {
        console.error(`PIN list must be a JSON array, got ${typeof parsed}`);
      }
    } catch (e) {
      console.error("Invalid JSON for PIN list", e);
      return [];
    }
  } else {
    candidates = trimmed.split(/[,\s]+/);
  }
  const pins: string[] = [];
  for (const c of candidates) {
    const pin = typeof c === "string" ? c.trim() : "";
    if (PIN_RE.test(pin)) pins.push(pin);
    else if (pin) console.error(`PIN dropped: must be 8 digits, got ${JSON.stringify(c)}`);
  }
  return pins;
}

// Memoised on the raw env string so `bun --watch` picks up .env edits.
const pinCache = new Map<string, { raw: string; pins: string[] }>();

function pinsFrom(prefix: string, uuid: string): string[] {
  const raw = envFor(prefix, uuid) ?? "";
  const key = `${prefix}:${uuid}`;
  const cached = pinCache.get(key);
  if (cached && cached.raw === raw) return cached.pins;
  const pins = parsePinList(raw || undefined);
  pinCache.set(key, { raw, pins });
  return pins;
}

export function sourcePins(uuid: string, source: "tv" | "signage"): string[] {
  return pinsFrom(source === "tv" ? "TV_PINS" : "SIGNAGE_PINS", uuid);
}

export function protectedPins(uuid: string): Set<string> {
  return new Set(slotsFor(uuid).map((s) => s.pin));
}

// An 8-digit code, kept as a string throughout: as a number the leading zero of
// roughly one draw in ten is lost and the comparison then never matches.
// Re-drawn while it collides with a configured PIN — a temporary code equal to a
// slot PIN would, on submission, take the master-override branch and revoke the
// very ownership it was meant to grant.
export function mintPin(uuid: string): string {
  const taken = new Set([
    ...protectedPins(uuid),
    ...sourcePins(uuid, "tv"),
    ...sourcePins(uuid, "signage"),
  ]);
  for (;;) {
    const pin = String(randomInt(0, 100_000_000)).padStart(8, "0");
    if (!taken.has(pin)) return pin;
  }
}

function emptyRecord(): AccessRecord {
  return {
    editGrants: new Map(),
    tv: new Map(),
    signage: new Map(),
    failures: { count: 0, until: 0 },
  };
}

function dropExpired(grants: Map<string, number>, now: number): void {
  for (const [device, expiry] of grants) {
    if (expiry <= now) grants.delete(device);
  }
}

// Applies everything that has lapsed since the last read, then returns the
// record. Called at the top of every exported function — this is what replaces a
// server tick.
function sweep(uuid: string, now: number): AccessRecord {
  const rec = access[uuid] ?? emptyRecord();
  access[uuid] = rec;

  // One condition covers both scheduled releases: the 90-minute deadline, and a
  // protected slot opening while someone holds temporary control.
  if (
    rec.ownership &&
    (now >= rec.ownership.expiresAt || activeSlot(slotsFor(uuid), now))
  ) {
    rec.ownership = undefined;
  }

  dropExpired(rec.editGrants, now);
  dropExpired(rec.tv, now);
  dropExpired(rec.signage, now);
  if (rec.failures.until && now >= rec.failures.until) {
    rec.failures = { count: 0, until: 0 };
  }

  // Evict an entry with nothing left to remember, so the map cannot grow without
  // bound as scoreboards come and go — the channel cache does the same.
  if (
    !rec.ownership &&
    !rec.editGrants.size &&
    !rec.tv.size &&
    !rec.signage.size &&
    !rec.failures.count
  ) {
    delete access[uuid];
  }
  return rec;
}

function holdsEditGrant(rec: AccessRecord, device: string): boolean {
  return rec.editGrants.has(device);
}

function isOwner(rec: AccessRecord, device: string): boolean {
  return rec.ownership?.devices.has(device) ?? false;
}

function canEditWith(
  rec: AccessRecord,
  device: string | undefined,
  slot: ParsedSlot | undefined
): boolean {
  if (!device) return false;
  // A slot or master PIN grant always works, inside a slot or out.
  if (holdsEditGrant(rec, device)) return true;
  // Inside a protected slot the slot PIN is compulsory, so temporary ownership
  // (which sweep has already revoked) grants nothing.
  if (slot) return false;
  return isOwner(rec, device);
}

// A source with no PINs configured is not left open: it falls back to requiring
// score-edit control, so an unconfigured venue is never less protected than a
// configured one.
function canSourceWith(
  rec: AccessRecord,
  uuid: string,
  device: string | undefined,
  source: "tv" | "signage",
  slot: ParsedSlot | undefined
): boolean {
  if (!device) return false;
  if (!sourcePins(uuid, source).length) return canEditWith(rec, device, slot);
  return (source === "tv" ? rec.tv : rec.signage).has(device);
}

export function can(
  uuid: string,
  device: string | undefined,
  capability: Capability,
  now = Date.now()
): boolean {
  const rec = sweep(uuid, now);
  const slot = activeSlot(slotsFor(uuid), now);
  if (capability === "edit") return canEditWith(rec, device, slot);
  return canSourceWith(rec, uuid, device, capability, slot);
}

// True when the phone holds any grant at all. Used by `display: "scoreboard"`,
// so an operator who unlocked only TV can still switch back to the score.
export function canAny(
  uuid: string,
  device: string | undefined,
  now = Date.now()
): boolean {
  return (
    can(uuid, device, "edit", now) ||
    can(uuid, device, "tv", now) ||
    can(uuid, device, "signage", now)
  );
}

export function accessStateFor(
  uuid: string,
  device: string | undefined,
  now = Date.now()
): AccessStateWire {
  const rec = sweep(uuid, now);
  const slots = slotsFor(uuid);
  const slot = activeSlot(slots, now);
  const owner = device ? isOwner(rec, device) : false;

  return {
    mode: slot ? "protected" : rec.ownership ? "temporary" : "open",
    canEdit: canEditWith(rec, device, slot),
    canTv: canSourceWith(rec, uuid, device, "tv", slot),
    canSignage: canSourceWith(rec, uuid, device, "signage", slot),
    owner,
    // Only an unowned, unprotected board can be taken without a PIN.
    claimable: !slot && !rec.ownership && !!device,
    // The PIN is a credential: it goes only to a phone that already holds
    // control, never to the read-only phones that also receive this payload.
    ...(owner && rec.ownership ? { pin: rec.ownership.pin } : {}),
    ...(owner && rec.ownership
      ? { expiresAt: rec.ownership.expiresAt, ownerCount: rec.ownership.devices.size }
      : device && holdsEditGrant(rec, device)
        ? { expiresAt: rec.editGrants.get(device) }
        : {}),
    ...(slot || slots.length ? { nextChange: nextBoundary(slots, now) } : {}),
  };
}

export function claim(
  uuid: string,
  device: string | undefined,
  now = Date.now()
): AccessResult {
  const rec = sweep(uuid, now);
  if (!device) return { status: 403 };
  if (activeSlot(slotsFor(uuid), now)) return { status: 423 };
  if (rec.ownership) return { status: 409 };

  access[uuid] = rec;
  rec.ownership = {
    pin: mintPin(uuid),
    claimedAt: now,
    expiresAt: now + CONTROL_TTL_MS,
    devices: new Set([device]),
  };
  return { status: 200 };
}

function recordFailure(rec: AccessRecord, uuid: string, now: number): void {
  rec.failures.count += 1;
  if (rec.failures.count >= MAX_FAILURES) {
    const over = rec.failures.count - MAX_FAILURES;
    rec.failures.until =
      now + Math.min(LOCKOUT_BASE_MS * 2 ** over, LOCKOUT_MAX_MS);
  }
  console.error(
    `Rejected PIN for ${uuid} (${rec.failures.count} consecutive failures)`
  );
}

export function unlock(
  uuid: string,
  device: string | undefined,
  pin: unknown,
  now = Date.now()
): AccessResult {
  const rec = sweep(uuid, now);
  if (!device) return { status: 403 };
  access[uuid] = rec;

  // Budget is per scoreboard, not per device: deviceId is client-supplied, so a
  // per-device budget would reset on every rotation.
  if (rec.failures.until > now) {
    return { status: 429, retryAfter: Math.ceil((rec.failures.until - now) / 1000) };
  }
  const candidate = typeof pin === "string" ? pin.trim() : "";
  if (!PIN_RE.test(candidate)) {
    recordFailure(rec, uuid, now);
    return { status: 401 };
  }

  const slot = activeSlot(slotsFor(uuid), now);

  // Precedence matters. Protected must be tested first: it is the branch that
  // implements "control can be overridden by one of the protected PIN codes",
  // and a code present in two namespaces must take the higher privilege.
  if (protectedPins(uuid).has(candidate)) {
    rec.ownership = undefined;
    rec.editGrants.set(
      device,
      slot ? slotEnd(slot, now) : now + CONTROL_TTL_MS
    );
    rec.failures = { count: 0, until: 0 };
    return { status: 200 };
  }

  // A source PIN is a lower-privilege venue credential: it unlocks its own
  // source and deliberately leaves ownership of the score alone.
  for (const source of ["tv", "signage"] as const) {
    if (sourcePins(uuid, source).includes(candidate)) {
      (source === "tv" ? rec.tv : rec.signage).set(
        device,
        now + SOURCE_GRANT_TTL_MS
      );
      rec.failures = { count: 0, until: 0 };
      return { status: 200 };
    }
  }

  // The live temporary PIN grants shared control. The deadline is not extended:
  // it was fixed when the board was first claimed and every holder is released
  // together.
  if (rec.ownership && rec.ownership.pin === candidate) {
    rec.ownership.devices.add(device);
    rec.failures = { count: 0, until: 0 };
    return { status: 200 };
  }

  recordFailure(rec, uuid, now);
  return { status: 401 };
}

// Pushes the deadline out by a full window. Owners only — a master-PIN grant
// holder has their own expiry and nothing to extend here.
export function extend(
  uuid: string,
  device: string | undefined,
  now = Date.now()
): AccessResult {
  const rec = sweep(uuid, now);
  if (!device || !rec.ownership || !isOwner(rec, device)) return { status: 403 };
  rec.ownership.expiresAt = now + CONTROL_TTL_MS;
  return { status: 200 };
}

// Hands the scoreboard back. Any holder may release for everyone — with shared
// control that is the point: whoever finishes last frees the board.
export function release(
  uuid: string,
  device: string | undefined,
  now = Date.now()
): AccessResult {
  const rec = sweep(uuid, now);
  if (!device) return { status: 403 };
  // Inside a protected slot the slot PIN is compulsory; there is no ownership to
  // give back, so releasing is meaningless rather than merely disallowed.
  if (activeSlot(slotsFor(uuid), now)) return { status: 423 };
  if (!isOwner(rec, device) && !holdsEditGrant(rec, device)) {
    return { status: 403 };
  }
  rec.ownership = undefined;
  rec.editGrants.clear();
  return { status: 200 };
}
