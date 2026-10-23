// Protected time slots: recurring weekly windows during which editing the score
// requires the slot's own PIN and no temporary control can be claimed. Configured
// per display as `PROTECTED_SLOTS_<UUID>`, a JSON array of
// `{ days, from, to, pin }`.
//
// Every function takes `now` explicitly so the calendar is testable at a fixed
// instant — there is no server tick anywhere in this codebase and nothing here
// reads the clock on its own.
import { envFor } from "./env-keys.js";
import type { ParsedSlot } from "./types.js";

export const SLOT_TZ = process.env.PROTECTED_SLOTS_TZ || "Europe/Brussels";

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MINUTES_PER_DAY = 24 * 60;

// The container sets no TZ (the image only exports NODE_ENV and PORT), so the
// server's local time is UTC and `Date#getDay`/`getHours` would place every slot
// an hour off for half the year. Formatting through an explicit time zone
// resolves the offset *at that instant*, which is what makes this DST-correct
// without pulling in a date library. Built once — constructing a DateTimeFormat
// is expensive relative to using one.
const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: SLOT_TZ,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Local weekday (0 = Monday) and minute-of-day in SLOT_TZ.
export function zonedNow(now: number): { day: number; minute: number } {
  const parts = FMT.formatToParts(new Date(now));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const day = DAY_NAMES.indexOf(get("weekday").toUpperCase().slice(0, 3));
  return {
    day,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

// "MON", "MON-FRI", "SAT,SUN", "FRI-MON" (ranges are inclusive and may wrap
// through Sunday). Unknown tokens are dropped with a message rather than
// failing the whole slot — a typo in one day shouldn't silently unprotect a
// window, but neither should it take the others down with it.
export function parseDays(spec: string): number[] {
  const days = new Set<number>();
  for (const token of spec.split(",")) {
    const t = token.trim().toUpperCase();
    if (!t) continue;
    const [fromName, toName] = t.split("-");
    const from = DAY_NAMES.indexOf(fromName);
    if (from < 0) {
      console.error(`Unknown day "${token.trim()}" in protected slot days "${spec}"`);
      continue;
    }
    if (toName === undefined) {
      days.add(from);
      continue;
    }
    const to = DAY_NAMES.indexOf(toName);
    if (to < 0) {
      console.error(`Unknown day "${toName}" in protected slot days "${spec}"`);
      continue;
    }
    // Inclusive, wrapping: FRI-MON is FRI, SAT, SUN, MON.
    for (let i = 0; i <= (to - from + 7) % 7; i++) days.add((from + i) % 7);
  }
  return [...days].sort((a, b) => a - b);
}

// "18:00" -> 1080. 24:00 is accepted as 1440 so an all-day slot has no
// one-minute hole at 23:59.
function parseMinute(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value.trim());
  if (!m) return undefined;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return minute > MINUTES_PER_DAY ? undefined : minute;
}

// Parses the raw env value. Follows the convention used by loadChannels: a bad
// value is reported in full and degrades to "no slots" rather than throwing on a
// path that would take the whole socket handler down.
export function parseSlots(raw: string | undefined): ParsedSlot[] {
  if (!raw) return [];
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON for protected slots", e);
    return [];
  }
  if (!Array.isArray(entries)) {
    console.error(
      `Protected slots must be a JSON array, got ${typeof entries}. No slots configured.`
    );
    return [];
  }

  const slots: ParsedSlot[] = [];
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const pin = typeof e?.pin === "string" ? e.pin.trim() : "";
    const fromMin = parseMinute(e?.from);
    const toMin = parseMinute(e?.to);
    const days = typeof e?.days === "string" ? parseDays(e.days) : [];

    if (!/^\d{8}$/.test(pin)) {
      console.error(`Protected slot dropped: "pin" must be 8 digits, got ${JSON.stringify(e?.pin)}`);
      continue;
    }
    if (fromMin === undefined || toMin === undefined) {
      console.error(
        `Protected slot dropped: "from"/"to" must be HH:MM, got ${JSON.stringify(e?.from)}/${JSON.stringify(e?.to)}`
      );
      continue;
    }
    if (!days.length) {
      console.error(`Protected slot dropped: no valid days in ${JSON.stringify(e?.days)}`);
      continue;
    }
    slots.push({ days, fromMin, toMin, pin });
  }
  return slots;
}

// Memoised on the raw string, so editing .env under `bun --watch` takes effect
// without a restart while a steady state costs one env read per call.
const slotCache = new Map<string, { raw: string; slots: ParsedSlot[] }>();

export function slotsFor(uuid: string): ParsedSlot[] {
  const raw = envFor("PROTECTED_SLOTS", uuid) ?? "";
  const cached = slotCache.get(uuid);
  if (cached && cached.raw === raw) return cached.slots;
  const slots = parseSlots(raw || undefined);
  slotCache.set(uuid, { raw, slots });
  return slots;
}

// `from` is inclusive, `to` exclusive. A slot whose `to` is at or before its
// `from` spans midnight — an evening fixture running past 00:00 is exactly the
// case these slots exist for — and then matches either the tail of its own day
// or the small hours of the following one.
function covers(slot: ParsedSlot, day: number, minute: number): boolean {
  if (slot.toMin > slot.fromMin) {
    return slot.days.includes(day) && minute >= slot.fromMin && minute < slot.toMin;
  }
  const previousDay = (day + 6) % 7;
  return (
    (slot.days.includes(day) && minute >= slot.fromMin) ||
    (slot.days.includes(previousDay) && minute < slot.toMin)
  );
}

export function activeSlot(
  slots: ParsedSlot[],
  now: number
): ParsedSlot | undefined {
  const { day, minute } = zonedNow(now);
  if (day < 0) return undefined;
  return slots.find((s) => covers(s, day, minute));
}

// When the currently active slot stops covering `now`. Used as the expiry of a
// grant obtained with a slot PIN inside its own slot.
export function slotEnd(slot: ParsedSlot, now: number): number {
  const { minute } = zonedNow(now);
  const until = slot.toMin > slot.fromMin ? slot.toMin : slot.toMin + MINUTES_PER_DAY;
  const target = minute < slot.toMin ? slot.toMin : until;
  return now + (target - minute) * 60_000;
}

// The next instant at which slot membership changes, as a hint for clients to
// re-query. Only ever a hint: enforcement is the per-event capability check, so
// being an hour out across a DST switch is harmless.
export function nextBoundary(
  slots: ParsedSlot[],
  now: number
): number | undefined {
  if (!slots.length) return undefined;
  const { day, minute } = zonedNow(now);
  if (day < 0) return undefined;

  let best: number | undefined;
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = (day + ahead) % 7;
    for (const slot of slots) {
      if (!slot.days.includes(d)) continue;
      for (const edge of [slot.fromMin, slot.toMin]) {
        const delta = ahead * MINUTES_PER_DAY + edge - minute;
        if (delta > 0 && (best === undefined || delta < best)) best = delta;
      }
    }
  }
  return best === undefined ? undefined : now + best * 60_000;
}
