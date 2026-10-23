import { describe, expect, it } from "bun:test";
import {
  activeSlot,
  nextBoundary,
  parseDays,
  parseSlots,
  slotEnd,
  zonedNow,
} from "./slots.js";
import type { ParsedSlot } from "./types.js";

// All assertions pin `now` explicitly. The slot calendar is evaluated in
// Europe/Brussels regardless of the server's own zone, which is UTC in the
// container, so these dates are chosen to exercise that difference.
const slot = (over: Partial<ParsedSlot> = {}): ParsedSlot => ({
  days: [0, 1, 2, 3, 4],
  fromMin: 18 * 60,
  toMin: 22 * 60,
  pin: "48127390",
  ...over,
});

describe("parseDays", () => {
  it("reads a single day", () => {
    expect(parseDays("WED")).toEqual([2]);
  });

  it("expands an inclusive range", () => {
    expect(parseDays("MON-FRI")).toEqual([0, 1, 2, 3, 4]);
  });

  it("reads a comma-separated list", () => {
    expect(parseDays("SAT,SUN")).toEqual([5, 6]);
  });

  it("wraps a range through Sunday", () => {
    expect(parseDays("FRI-MON")).toEqual([0, 4, 5, 6]);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseDays(" mon , wed ")).toEqual([0, 2]);
  });

  it("drops unknown tokens but keeps the valid ones", () => {
    expect(parseDays("MON,FUNDAY,FRI")).toEqual([0, 4]);
  });
});

describe("parseSlots", () => {
  it("returns nothing for an unset var", () => {
    expect(parseSlots(undefined)).toEqual([]);
  });

  it("parses a well-formed slot", () => {
    expect(
      parseSlots('[{"days":"MON-FRI","from":"18:00","to":"22:00","pin":"48127390"}]')
    ).toEqual([{ days: [0, 1, 2, 3, 4], fromMin: 1080, toMin: 1320, pin: "48127390" }]);
  });

  it("degrades to no slots on malformed JSON instead of throwing", () => {
    expect(parseSlots("{not json")).toEqual([]);
  });

  it("degrades to no slots when the value is not an array", () => {
    expect(parseSlots('{"days":"MON"}')).toEqual([]);
  });

  it("drops a slot whose pin is not 8 digits", () => {
    expect(
      parseSlots('[{"days":"MON","from":"18:00","to":"22:00","pin":"1234567"}]')
    ).toEqual([]);
  });

  it("drops a slot with an out-of-range time", () => {
    expect(
      parseSlots('[{"days":"MON","from":"25:00","to":"22:00","pin":"48127390"}]')
    ).toEqual([]);
  });

  it("accepts 24:00 as end-of-day so an all-day slot has no gap", () => {
    expect(
      parseSlots('[{"days":"MON","from":"00:00","to":"24:00","pin":"48127390"}]')[0]
    ).toMatchObject({ fromMin: 0, toMin: 1440 });
  });

  it("keeps valid slots alongside dropped ones", () => {
    const parsed = parseSlots(
      '[{"days":"MON","from":"bad","to":"22:00","pin":"48127390"},' +
        '{"days":"TUE","from":"09:00","to":"10:00","pin":"71905534"}]'
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pin).toBe("71905534");
  });
});

describe("zonedNow", () => {
  it("reports Brussels wall-clock time, not the server's UTC", () => {
    // 2026-07-01T12:00Z is 14:00 in Brussels (CEST, UTC+2), a Wednesday.
    expect(zonedNow(Date.parse("2026-07-01T12:00:00Z"))).toEqual({
      day: 2,
      minute: 14 * 60,
    });
  });

  it("uses the winter offset in January", () => {
    // CET (UTC+1): 12:00Z is 13:00 local, a Thursday.
    expect(zonedNow(Date.parse("2026-01-01T12:00:00Z"))).toEqual({
      day: 3,
      minute: 13 * 60,
    });
  });
});

describe("activeSlot", () => {
  const slots = [slot()];

  it("matches inside the window", () => {
    // Wed 2026-07-01, 19:00 Brussels.
    expect(activeSlot(slots, Date.parse("2026-07-01T17:00:00Z"))).toBeDefined();
  });

  it("does not match before it opens", () => {
    // 17:59 Brussels.
    expect(activeSlot(slots, Date.parse("2026-07-01T15:59:00Z"))).toBeUndefined();
  });

  it("includes the opening minute and excludes the closing one", () => {
    expect(activeSlot(slots, Date.parse("2026-07-01T16:00:00Z"))).toBeDefined();
    expect(activeSlot(slots, Date.parse("2026-07-01T20:00:00Z"))).toBeUndefined();
  });

  it("does not match on a day outside the range", () => {
    // Sat 2026-07-04, 19:00 Brussels.
    expect(activeSlot(slots, Date.parse("2026-07-04T17:00:00Z"))).toBeUndefined();
  });

  it("matches nothing when no slots are configured", () => {
    expect(activeSlot([], Date.parse("2026-07-01T17:00:00Z"))).toBeUndefined();
  });

  describe("spanning midnight", () => {
    // Fri 22:00 -> 01:00, i.e. an evening fixture running past midnight.
    const overnight = [slot({ days: [4], fromMin: 22 * 60, toMin: 60 })];

    it("matches the evening side", () => {
      // Fri 2026-07-03, 23:00 Brussels.
      expect(activeSlot(overnight, Date.parse("2026-07-03T21:00:00Z"))).toBeDefined();
    });

    it("matches the small hours of the following day", () => {
      // Sat 2026-07-04, 00:30 Brussels — still the Friday slot.
      expect(activeSlot(overnight, Date.parse("2026-07-03T22:30:00Z"))).toBeDefined();
    });

    it("stops at the closing time", () => {
      // Sat 2026-07-04, 01:00 Brussels.
      expect(activeSlot(overnight, Date.parse("2026-07-03T23:00:00Z"))).toBeUndefined();
    });
  });

  // The whole reason for formatting through an explicit time zone: a slot must
  // stay at its local wall-clock time on both sides of a DST transition, even
  // though the server's own clock is UTC.
  describe("across DST transitions", () => {
    it("holds its local time after the spring-forward (2026-03-29)", () => {
      // 19:00 Brussels = 17:00Z under CEST. The Sunday itself is outside
      // MON-FRI, so check the Monday after.
      expect(activeSlot(slots, Date.parse("2026-03-30T17:00:00Z"))).toBeDefined();
      // 17:00 Brussels = 15:00Z, before the slot opens.
      expect(activeSlot(slots, Date.parse("2026-03-30T15:00:00Z"))).toBeUndefined();
    });

    it("holds its local time after the autumn fall-back (2026-10-25)", () => {
      // 19:00 Brussels = 18:00Z under CET, on the Monday after.
      expect(activeSlot(slots, Date.parse("2026-10-26T18:00:00Z"))).toBeDefined();
      // The same UTC instant that matched in summer is now 17:00 local, outside.
      expect(activeSlot(slots, Date.parse("2026-10-26T16:00:00Z"))).toBeUndefined();
    });
  });
});

describe("slotEnd", () => {
  it("returns the instant the window closes", () => {
    // 19:00 Brussels, slot ends 22:00 -> 3h.
    const now = Date.parse("2026-07-01T17:00:00Z");
    expect(slotEnd(slot(), now) - now).toBe(3 * 60 * 60 * 1000);
  });

  it("carries past midnight for an overnight window", () => {
    // Fri 23:00 Brussels, slot ends 01:00 -> 2h.
    const now = Date.parse("2026-07-03T21:00:00Z");
    const overnight = slot({ days: [4], fromMin: 22 * 60, toMin: 60 });
    expect(slotEnd(overnight, now) - now).toBe(2 * 60 * 60 * 1000);
  });
});

describe("nextBoundary", () => {
  it("is undefined with no slots", () => {
    expect(nextBoundary([], Date.now())).toBeUndefined();
  });

  it("points at the opening time when outside", () => {
    // Wed 17:00 Brussels -> opens at 18:00, 1h away.
    const now = Date.parse("2026-07-01T15:00:00Z");
    expect(nextBoundary([slot()], now)! - now).toBe(60 * 60 * 1000);
  });

  it("points at the closing time when inside", () => {
    // Wed 19:00 Brussels -> closes at 22:00, 3h away.
    const now = Date.parse("2026-07-01T17:00:00Z");
    expect(nextBoundary([slot()], now)! - now).toBe(3 * 60 * 60 * 1000);
  });
});
