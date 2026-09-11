import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  accessStateFor,
  can,
  canAny,
  claim,
  extend,
  mintPin,
  release,
  resetAccess,
  unlock,
} from "./access.js";
import { CONTROL_TTL_MS, SOURCE_GRANT_TTL_MS } from "./config.js";

// A fixed instant well inside a weekday evening, so the MON-FRI 18:00-22:00 slot
// used below is active when configured and irrelevant when not.
const WED_1900 = Date.parse("2026-07-01T17:00:00Z"); // 19:00 Brussels, Wednesday
const WED_1200 = Date.parse("2026-07-01T10:00:00Z"); // 12:00 Brussels, Wednesday

const UUID = "aaaaaaaa-0000-4000-8000-000000000001";
const ENV_UUID = "aaaaaaaa_0000_4000_8000_000000000001";
const SLOT_PIN = "48127390";
const TV_PIN = "11112222";
const SIGNAGE_PIN = "33334444";

const PHONE_A = "device-a";
const PHONE_B = "device-b";

const ENV_KEYS = [
  `PROTECTED_SLOTS_${ENV_UUID}`,
  `TV_PINS_${ENV_UUID}`,
  `SIGNAGE_PINS_${ENV_UUID}`,
];

function configureSlots() {
  process.env[`PROTECTED_SLOTS_${ENV_UUID}`] =
    `[{"days":"MON-FRI","from":"18:00","to":"22:00","pin":"${SLOT_PIN}"}]`;
}
function configureSourcePins() {
  process.env[`TV_PINS_${ENV_UUID}`] = `["${TV_PIN}"]`;
  process.env[`SIGNAGE_PINS_${ENV_UUID}`] = SIGNAGE_PIN;
}

beforeEach(() => {
  resetAccess();
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("claiming an open scoreboard", () => {
  it("mints an 8-digit PIN and binds it to the claiming phone", () => {
    expect(claim(UUID, PHONE_A, WED_1200).status).toBe(200);
    const s = accessStateFor(UUID, PHONE_A, WED_1200);
    expect(s.mode).toBe("temporary");
    expect(s.owner).toBe(true);
    expect(s.canEdit).toBe(true);
    expect(s.pin).toMatch(/^\d{8}$/);
    expect(s.expiresAt).toBe(WED_1200 + CONTROL_TTL_MS);
  });

  it("refuses a phone with no device id", () => {
    expect(claim(UUID, undefined, WED_1200).status).toBe(403);
  });

  it("rejects a second claim without disturbing the first", () => {
    claim(UUID, PHONE_A, WED_1200);
    const pin = accessStateFor(UUID, PHONE_A, WED_1200).pin;

    expect(claim(UUID, PHONE_B, WED_1200).status).toBe(409);

    const after = accessStateFor(UUID, PHONE_A, WED_1200);
    expect(after.pin).toBe(pin);
    expect(after.expiresAt).toBe(WED_1200 + CONTROL_TTL_MS);
    expect(can(UUID, PHONE_B, "edit", WED_1200)).toBe(false);
  });

  it("does not leak the PIN to a phone that is not in control", () => {
    claim(UUID, PHONE_A, WED_1200);
    const outsider = accessStateFor(UUID, PHONE_B, WED_1200);
    expect(outsider.pin).toBeUndefined();
    expect(outsider.owner).toBe(false);
    expect(outsider.canEdit).toBe(false);
  });
});

describe("shared control", () => {
  it("lets a second phone join with the temporary PIN, inheriting the deadline", () => {
    claim(UUID, PHONE_A, WED_1200);
    const pin = accessStateFor(UUID, PHONE_A, WED_1200).pin!;

    expect(unlock(UUID, PHONE_B, pin, WED_1200 + 1000).status).toBe(200);

    const b = accessStateFor(UUID, PHONE_B, WED_1200 + 1000);
    expect(b.owner).toBe(true);
    expect(b.canEdit).toBe(true);
    expect(b.ownerCount).toBe(2);
    // Joining does not push the deadline out — it was fixed at the first claim.
    expect(b.expiresAt).toBe(WED_1200 + CONTROL_TTL_MS);
  });

  it("rejects a wrong PIN", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(unlock(UUID, PHONE_B, "00000000", WED_1200).status).toBe(401);
    expect(can(UUID, PHONE_B, "edit", WED_1200)).toBe(false);
  });

  it("rejects a malformed PIN without consulting any namespace", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(unlock(UUID, PHONE_B, "123", WED_1200).status).toBe(401);
    expect(unlock(UUID, PHONE_B, 12345678, WED_1200).status).toBe(401);
  });
});

describe("the 90-minute deadline", () => {
  it("still grants control one millisecond before it lapses", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(can(UUID, PHONE_A, "edit", WED_1200 + CONTROL_TTL_MS - 1)).toBe(true);
  });

  it("releases every holder together when it passes", () => {
    claim(UUID, PHONE_A, WED_1200);
    const pin = accessStateFor(UUID, PHONE_A, WED_1200).pin!;
    unlock(UUID, PHONE_B, pin, WED_1200);

    const after = WED_1200 + CONTROL_TTL_MS;
    expect(can(UUID, PHONE_A, "edit", after)).toBe(false);
    expect(can(UUID, PHONE_B, "edit", after)).toBe(false);
    expect(accessStateFor(UUID, PHONE_A, after).mode).toBe("open");
    expect(accessStateFor(UUID, PHONE_A, after).claimable).toBe(true);
  });

  it("is pushed out by an owner's extend", () => {
    claim(UUID, PHONE_A, WED_1200);
    const later = WED_1200 + CONTROL_TTL_MS - 1000;

    expect(extend(UUID, PHONE_A, later).status).toBe(200);

    expect(accessStateFor(UUID, PHONE_A, later).expiresAt).toBe(later + CONTROL_TTL_MS);
    // The instant that would have released it now still grants control.
    expect(can(UUID, PHONE_A, "edit", WED_1200 + CONTROL_TTL_MS)).toBe(true);
  });

  it("cannot be extended by a phone that does not hold control", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(extend(UUID, PHONE_B, WED_1200).status).toBe(403);
  });

  it("cannot be extended once it has already lapsed", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(extend(UUID, PHONE_A, WED_1200 + CONTROL_TTL_MS).status).toBe(403);
  });
});

describe("releasing", () => {
  it("hands the board back for everyone", () => {
    claim(UUID, PHONE_A, WED_1200);
    const pin = accessStateFor(UUID, PHONE_A, WED_1200).pin!;
    unlock(UUID, PHONE_B, pin, WED_1200);

    expect(release(UUID, PHONE_B, WED_1200).status).toBe(200);
    expect(can(UUID, PHONE_A, "edit", WED_1200)).toBe(false);
    expect(can(UUID, PHONE_B, "edit", WED_1200)).toBe(false);
    expect(accessStateFor(UUID, PHONE_A, WED_1200).claimable).toBe(true);
  });

  it("refuses a phone holding no grant", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(release(UUID, PHONE_B, WED_1200).status).toBe(403);
    expect(can(UUID, PHONE_A, "edit", WED_1200)).toBe(true);
  });

  it("is meaningless inside a protected slot", () => {
    configureSlots();
    unlock(UUID, PHONE_A, SLOT_PIN, WED_1900);
    expect(release(UUID, PHONE_A, WED_1900).status).toBe(423);
  });
});

describe("protected slots", () => {
  beforeEach(configureSlots);

  it("reports protected mode and refuses a claim", () => {
    const s = accessStateFor(UUID, PHONE_A, WED_1900);
    expect(s.mode).toBe("protected");
    expect(s.claimable).toBe(false);
    expect(s.canEdit).toBe(false);
    expect(claim(UUID, PHONE_A, WED_1900).status).toBe(423);
  });

  it("grants edit for the rest of the slot when the slot PIN is entered", () => {
    expect(unlock(UUID, PHONE_A, SLOT_PIN, WED_1900).status).toBe(200);
    expect(can(UUID, PHONE_A, "edit", WED_1900)).toBe(true);
    // The slot closes at 22:00 Brussels, three hours after 19:00.
    expect(accessStateFor(UUID, PHONE_A, WED_1900).expiresAt).toBe(
      WED_1900 + 3 * 60 * 60 * 1000
    );
    // ...and the grant lapses with the slot.
    expect(can(UUID, PHONE_A, "edit", WED_1900 + 3 * 60 * 60 * 1000)).toBe(false);
  });

  it("revokes temporary control held when the slot opens", () => {
    // Claimed at 17:30 Brussels, before the 18:00 slot opens.
    const before = Date.parse("2026-07-01T15:30:00Z");
    claim(UUID, PHONE_A, before);
    expect(can(UUID, PHONE_A, "edit", before)).toBe(true);

    const inside = Date.parse("2026-07-01T16:30:00Z"); // 18:30 Brussels
    expect(can(UUID, PHONE_A, "edit", inside)).toBe(false);
    expect(accessStateFor(UUID, PHONE_A, inside).mode).toBe("protected");
  });
});

describe("protected PINs as master keys", () => {
  beforeEach(configureSlots);

  it("override an active temporary owner from outside any slot", () => {
    claim(UUID, PHONE_A, WED_1200);
    expect(can(UUID, PHONE_A, "edit", WED_1200)).toBe(true);

    expect(unlock(UUID, PHONE_B, SLOT_PIN, WED_1200).status).toBe(200);

    // The previous owner is out; the override holder is in.
    expect(can(UUID, PHONE_A, "edit", WED_1200)).toBe(false);
    expect(can(UUID, PHONE_B, "edit", WED_1200)).toBe(true);
    expect(accessStateFor(UUID, PHONE_B, WED_1200).mode).toBe("open");
  });

  it("grant a full control window when used outside a slot", () => {
    unlock(UUID, PHONE_A, SLOT_PIN, WED_1200);
    expect(accessStateFor(UUID, PHONE_A, WED_1200).expiresAt).toBe(
      WED_1200 + CONTROL_TTL_MS
    );
  });

  it("take precedence over an identical temporary PIN", () => {
    // Force the collision the minting loop is designed to avoid, and assert the
    // protected branch wins: the master key must never be interpreted as a
    // request to join the session it is meant to seize.
    claim(UUID, PHONE_A, WED_1200);
    process.env[`PROTECTED_SLOTS_${ENV_UUID}`] =
      `[{"days":"MON-FRI","from":"18:00","to":"22:00","pin":"${accessStateFor(UUID, PHONE_A, WED_1200).pin}"}]`;
    const shared = accessStateFor(UUID, PHONE_A, WED_1200).pin!;

    expect(unlock(UUID, PHONE_B, shared, WED_1200).status).toBe(200);
    expect(can(UUID, PHONE_A, "edit", WED_1200)).toBe(false); // seized, not joined
  });
});

describe("mintPin", () => {
  it("never collides with a configured PIN", () => {
    // Stuff every namespace, then draw repeatedly.
    const many = Array.from({ length: 500 }, (_, i) =>
      String(i).padStart(8, "0")
    );
    process.env[`TV_PINS_${ENV_UUID}`] = JSON.stringify(many);
    configureSlots();
    const taken = new Set([...many, SLOT_PIN]);

    for (let i = 0; i < 1000; i++) {
      const pin = mintPin(UUID);
      expect(pin).toMatch(/^\d{8}$/);
      expect(taken.has(pin)).toBe(false);
    }
  });

  it("keeps leading zeros so the string comparison can match", () => {
    // Exercised statistically: every draw must be exactly 8 characters, which is
    // the property lost if a PIN is ever stored as a number.
    for (let i = 0; i < 2000; i++) expect(mintPin(UUID)).toHaveLength(8);
  });
});

describe("source PINs", () => {
  beforeEach(configureSourcePins);

  it("unlock only their own source and leave the score alone", () => {
    expect(unlock(UUID, PHONE_A, TV_PIN, WED_1200).status).toBe(200);
    const s = accessStateFor(UUID, PHONE_A, WED_1200);
    expect(s.canTv).toBe(true);
    expect(s.canSignage).toBe(false);
    expect(s.canEdit).toBe(false);
  });

  it("accept a bare (non-JSON) single value in .env", () => {
    expect(unlock(UUID, PHONE_A, SIGNAGE_PIN, WED_1200).status).toBe(200);
    expect(can(UUID, PHONE_A, "signage", WED_1200)).toBe(true);
  });

  it("do not seize an active temporary ownership", () => {
    claim(UUID, PHONE_A, WED_1200);
    unlock(UUID, PHONE_B, TV_PIN, WED_1200);
    expect(can(UUID, PHONE_A, "edit", WED_1200)).toBe(true);
    expect(can(UUID, PHONE_B, "edit", WED_1200)).toBe(false);
  });

  it("last well beyond a control window but not forever", () => {
    unlock(UUID, PHONE_A, TV_PIN, WED_1200);
    expect(can(UUID, PHONE_A, "tv", WED_1200 + 60 * 60 * 1000)).toBe(true);
    expect(can(UUID, PHONE_A, "tv", WED_1200 + SOURCE_GRANT_TTL_MS)).toBe(false);
  });

  it("fall back to requiring edit control when unconfigured", () => {
    delete process.env[`TV_PINS_${ENV_UUID}`];
    expect(can(UUID, PHONE_A, "tv", WED_1200)).toBe(false);
    claim(UUID, PHONE_A, WED_1200);
    expect(can(UUID, PHONE_A, "tv", WED_1200)).toBe(true);
  });

  it("satisfy canAny, so a TV-only phone can switch back to the scoreboard", () => {
    unlock(UUID, PHONE_A, TV_PIN, WED_1200);
    expect(canAny(UUID, PHONE_A, WED_1200)).toBe(true);
    expect(canAny(UUID, PHONE_B, WED_1200)).toBe(false);
  });
});

describe("brute-force budget", () => {
  it("locks out after repeated failures, even across rotating device ids", () => {
    configureSlots();
    for (let i = 0; i < 5; i++) {
      expect(unlock(UUID, `rotating-${i}`, "00000000", WED_1200).status).toBe(401);
    }
    const locked = unlock(UUID, "rotating-fresh", "00000000", WED_1200);
    expect(locked.status).toBe(429);
    expect(locked.retryAfter).toBeGreaterThan(0);
  });

  it("blocks even a correct PIN while locked out", () => {
    configureSlots();
    for (let i = 0; i < 5; i++) unlock(UUID, PHONE_A, "00000000", WED_1200);
    expect(unlock(UUID, PHONE_A, SLOT_PIN, WED_1200).status).toBe(429);
  });

  it("clears once the window passes", () => {
    configureSlots();
    for (let i = 0; i < 5; i++) unlock(UUID, PHONE_A, "00000000", WED_1200);
    const later = WED_1200 + 61_000;
    expect(unlock(UUID, PHONE_A, SLOT_PIN, later).status).toBe(200);
  });

  it("is reset by a successful unlock", () => {
    configureSlots();
    for (let i = 0; i < 4; i++) unlock(UUID, PHONE_A, "00000000", WED_1200);
    expect(unlock(UUID, PHONE_A, SLOT_PIN, WED_1200).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect(unlock(UUID, PHONE_B, "00000000", WED_1200).status).toBe(401);
    }
  });
});

describe("a socket with no device id", () => {
  it("never obtains any capability", () => {
    configureSourcePins();
    claim(UUID, PHONE_A, WED_1200);
    expect(unlock(UUID, undefined, TV_PIN, WED_1200).status).toBe(403);
    expect(can(UUID, undefined, "edit", WED_1200)).toBe(false);
    expect(can(UUID, undefined, "tv", WED_1200)).toBe(false);
    expect(canAny(UUID, undefined, WED_1200)).toBe(false);
    expect(accessStateFor(UUID, undefined, WED_1200).claimable).toBe(false);
  });
});

describe("an unconfigured, unclaimed scoreboard", () => {
  it("is open, claimable and grants nothing until claimed", () => {
    const s = accessStateFor(UUID, PHONE_A, WED_1200);
    expect(s.mode).toBe("open");
    expect(s.claimable).toBe(true);
    expect(s.canEdit).toBe(false);
    expect(s.pin).toBeUndefined();
    expect(s.nextChange).toBeUndefined();
  });
});

describe("per-display control window", () => {
  it("overrides the default TTL for that scoreboard only", () => {
    const key = `CONTROL_TTL_MS_${ENV_UUID}`;
    process.env[key] = "4000";
    try {
      claim(UUID, PHONE_A, WED_1200);
      expect(accessStateFor(UUID, PHONE_A, WED_1200).expiresAt).toBe(WED_1200 + 4000);
      expect(can(UUID, PHONE_A, "edit", WED_1200 + 3999)).toBe(true);
      expect(can(UUID, PHONE_A, "edit", WED_1200 + 4000)).toBe(false);

      // A different scoreboard keeps the default window.
      const other = "bbbbbbbb-0000-4000-8000-000000000002";
      claim(other, PHONE_A, WED_1200);
      expect(accessStateFor(other, PHONE_A, WED_1200).expiresAt).toBe(
        WED_1200 + CONTROL_TTL_MS
      );
    } finally {
      delete process.env[key];
    }
  });

  it("ignores a non-numeric or non-positive override", () => {
    const key = `CONTROL_TTL_MS_${ENV_UUID}`;
    for (const bad of ["nonsense", "0", "-5"]) {
      process.env[key] = bad;
      resetAccess();
      claim(UUID, PHONE_A, WED_1200);
      expect(accessStateFor(UUID, PHONE_A, WED_1200).expiresAt).toBe(
        WED_1200 + CONTROL_TTL_MS
      );
    }
    delete process.env[key];
  });
});
