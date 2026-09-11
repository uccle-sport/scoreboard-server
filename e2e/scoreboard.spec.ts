import { test, expect, type Page, type Browser } from "@playwright/test";

const SECRET = "test-secret";

// Fixed scoreboards carrying per-display env config; see playwright.config.ts.
const CONFIGURED = "e2e00000-0000-4000-8000-000000000001";
const SLOTTED = "e2e00000-0000-4000-8000-000000000002";
const EXPIRING = "e2e00000-0000-4000-8000-000000000003";
const TV_PIN = "11112222";
const SLOT_PIN = "48127390";

function uuid() {
  return crypto.randomUUID();
}

function adminURL(uid: string) {
  return `/admin/?secret=${SECRET}&uuid=${uid}`;
}

function displayURL(uid: string) {
  return `/?secret=${SECRET}&uuid=${uid}`;
}

async function navigateAndWait(page: Page, url: string) {
  await page.goto(url);
  await page.getByTestId("home-score").waitFor({ state: "visible" });
}

/**
 * Claim an unowned scoreboard. Every phone now starts read-only, so any test
 * that changes the score has to take control first.
 */
async function takeControl(page: Page) {
  await page.getByTestId("access-claim").click();
  await expect(page.getByTestId("access-banner")).toBeHidden();
}

/** Read the control PIN from the owner's settings screen. */
async function readControlPin(page: Page): Promise<string> {
  await page.getByTestId("nav-settings").click();
  const pin = (await page.getByTestId("control-pin").textContent())?.trim();
  expect(pin).toMatch(/^\d{8}$/);
  return pin!;
}

/** Enter a PIN into the banner's keypad. */
async function enterPin(page: Page, pin: string) {
  await page.getByTestId("access-enter-code").click();
  await page.getByTestId("access-pin").fill(pin);
}

/**
 * Wait until the server reports at least `n` registered sockets for the
 * given scoreboard UUID. Socket.IO clients may disconnect and reconnect
 * during the initial handshake; this confirms all connections have fully
 * stabilized before the test proceeds.
 */
async function waitForSockets(uid: string, n: number) {
  const url = `http://localhost:5050/debug/sockets/${uid}`;
  await expect(async () => {
    const resp = await fetch(url);
    const data = await resp.json();
    expect(data.sockets).toBeGreaterThanOrEqual(n);
  }).toPass({ timeout: 10_000 });
}

async function openThreeClients(browser: Browser, uid: string) {
  const ctxDisplay = await browser.newContext();
  const display = await ctxDisplay.newPage();
  await navigateAndWait(display, displayURL(uid));

  const ctxAdmin1 = await browser.newContext();
  const admin1 = await ctxAdmin1.newPage();
  await navigateAndWait(admin1, adminURL(uid));

  const ctxAdmin2 = await browser.newContext();
  const admin2 = await ctxAdmin2.newPage();
  await navigateAndWait(admin2, adminURL(uid));

  // Wait for all 3 sockets to be registered on the server
  await waitForSockets(uid, 3);

  return { display, admin1, admin2, ctxDisplay, ctxAdmin1, ctxAdmin2 };
}

async function closeAll(...contexts: { close(): Promise<void> }[]) {
  await Promise.all(contexts.map((c) => c.close()));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Scoreboard real-time E2E", () => {
  test("score propagation", async ({ browser }) => {
    const uid = uuid();
    const { display, admin1, admin2, ctxDisplay, ctxAdmin1, ctxAdmin2 } =
      await openThreeClients(browser, uid);

    await takeControl(admin1);

    // Admin 1 clicks +1 on home score
    await admin1.getByTestId("home-plus").click();

    // Verify all three clients converge on home score = 1
    await expect(async () => {
      const [a1, d, a2] = await Promise.all([
        admin1.getByTestId("home-score").textContent(),
        display.getByTestId("home-score").textContent(),
        admin2.getByTestId("home-score").textContent(),
      ]);
      expect(a1?.trim()).toBe("1");
      expect(d?.trim()).toBe("1");
      expect(a2?.trim()).toBe("1");
    }).toPass({ timeout: 10_000 });

    await closeAll(ctxDisplay, ctxAdmin1, ctxAdmin2);
  });

  test("team name propagation", async ({ browser }) => {
    const uid = uuid();
    const { display, admin1, admin2, ctxDisplay, ctxAdmin1, ctxAdmin2 } =
      await openThreeClients(browser, uid);

    await takeControl(admin1);

    // Admin 1 navigates to Settings and changes home team name
    await admin1.getByTestId("nav-settings").click();
    const homeInput = admin1.getByTestId("home-team-input");
    await homeInput.fill("Lions");

    // Admin 2 navigates to Settings so its input is visible
    await admin2.getByTestId("nav-settings").click();

    // Verify display and admin2 both show "Lions"
    await expect(async () => {
      const [dName, a2Val] = await Promise.all([
        display.getByTestId("home-team").textContent(),
        admin2.getByTestId("home-team-input").inputValue(),
      ]);
      expect(dName?.trim()).toBe("Lions");
      expect(a2Val).toBe("Lions");
    }).toPass({ timeout: 10_000 });

    await closeAll(ctxDisplay, ctxAdmin1, ctxAdmin2);
  });

  test("period change propagation", async ({ browser }) => {
    const uid = uuid();
    const { display, admin1, admin2, ctxDisplay, ctxAdmin1, ctxAdmin2 } =
      await openThreeClients(browser, uid);

    await takeControl(admin1);

    // Admin 1 clicks "2nd Quarter"
    await admin1.getByRole("button", { name: "2nd Quarter" }).click();

    // Verify all three clients show "2nd Quarter"
    await expect(async () => {
      const [a1, a2, d] = await Promise.all([
        admin1.getByTestId("period").textContent(),
        admin2.getByTestId("period").textContent(),
        display.getByTestId("period").textContent(),
      ]);
      expect(a1?.trim()).toBe("2nd Quarter");
      expect(a2?.trim()).toBe("2nd Quarter");
      expect(d).toContain("2nd Quarter");
    }).toPass({ timeout: 10_000 });

    await closeAll(ctxDisplay, ctxAdmin1, ctxAdmin2);
  });

  test("conflict resolution — simultaneous updates", async ({ browser }) => {
    const uid = uuid();
    const { display, admin1, admin2, ctxDisplay, ctxAdmin1, ctxAdmin2 } =
      await openThreeClients(browser, uid);

    // Admin 1 takes control and shares its code, so both can edit — which makes
    // this a shared-control test as well as a conflict test.
    await takeControl(admin1);
    const pin = await readControlPin(admin1);
    // Send admin1 back before admin2 starts typing, so the display command that
    // the tab change emits has settled well before the race below.
    await admin1.getByRole("button", { name: "Scoreboard" }).click();
    await enterPin(admin2, pin);
    await expect(admin2.getByTestId("access-banner")).toBeHidden();
    await expect(admin1.getByTestId("home-plus")).toBeEnabled();
    await expect(admin2.getByTestId("away-plus")).toBeEnabled();
    // Let the access broadcasts from the two unlocks drain, so both clients
    // enter the race below holding the same rev — which is what makes one of
    // the two updates conflict.
    await admin1.waitForTimeout(500);

    // Confirm starting state: both scores are 0
    await expect(admin1.getByTestId("home-score")).toHaveText("0");
    await expect(admin1.getByTestId("away-score")).toHaveText("0");

    // Both admins click simultaneously — admin1 on home +1, admin2 on away +1.
    await Promise.all([
      admin1.getByTestId("home-plus").click(),
      admin2.getByTestId("away-plus").click(),
    ]);

    // Wait for convergence — the 409 client auto-resyncs.
    await expect(async () => {
      const [dHA1, dAA1, dHA2, dAA2, dHD, dAD] = await Promise.all([
        admin1.getByTestId("home-score").textContent(),
        admin1.getByTestId("away-score").textContent(),
        admin2.getByTestId("home-score").textContent(),
        admin2.getByTestId("away-score").textContent(),
        display.getByTestId("home-score").textContent(),
        display.getByTestId("away-score").textContent(),
      ]);

      const sum1 = Number(dHA1) + Number(dAA1);
      const sum2 = Number(dHA2) + Number(dAA2);
      const sumD = Number(dHD) + Number(dAD);

      // Only one update was accepted => total score is 1
      expect(sum1).toBe(1);
      expect(sum2).toBe(1);
      expect(sumD).toBe(1);

      // All three agree on individual scores
      expect(dHA1).toBe(dHA2);
      expect(dHA1).toBe(dHD);
      expect(dAA1).toBe(dAA2);
      expect(dAA1).toBe(dAD);
    }).toPass({ timeout: 5_000 });

    await closeAll(ctxDisplay, ctxAdmin1, ctxAdmin2);
  });

  test("the display freezes the countdown at 1:00 while the app keeps running", async ({
    browser,
  }) => {
    const uid = uuid();
    const { display, admin1, ctxDisplay, ctxAdmin1, ctxAdmin2 } =
      await openThreeClients(browser, uid);

    await takeControl(admin1);

    // Start the clock just above the 1-minute mark.
    await admin1.getByPlaceholder("MM:SS").fill("01:05");
    await admin1.getByRole("button", { name: "Set", exact: true }).click();
    await admin1.getByTestId("timer-toggle").click();

    // The app's own countdown keeps running past 1:00...
    await expect(async () => {
      const text = (await admin1.getByTestId("timer-display").textContent())?.trim();
      const [mins, secs] = text!.split(":").map(Number);
      expect(mins * 60 + secs).toBeLessThan(60);
    }).toPass({ timeout: 8_000 });

    // ...but the display holds at 1:00.
    await expect(display.getByTestId("play-time")).toHaveText("01:00");

    await closeAll(ctxDisplay, ctxAdmin1, ctxAdmin2);
  });
});

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

test.describe("PIN access control", () => {
  test("a fresh phone is read-only until it takes control", async ({ browser }) => {
    const uid = uuid();
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(uid));

    await expect(admin.getByTestId("access-banner")).toBeVisible();
    await expect(admin.getByTestId("home-plus")).toBeDisabled();

    // The score must not move even if the control is somehow reached.
    await expect(admin.getByTestId("home-score")).toHaveText("0");

    await takeControl(admin);
    await expect(admin.getByTestId("home-plus")).toBeEnabled();

    await closeAll(ctx);
  });

  test("claiming shows a shareable PIN and QR in settings", async ({ browser }) => {
    const uid = uuid();
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(uid));

    await takeControl(admin);
    const pin = await readControlPin(admin);
    expect(pin).toMatch(/^\d{8}$/);
    await expect(admin.getByTestId("control-pin-qr")).toBeVisible();
    await expect(admin.getByTestId("release-control")).toBeVisible();

    await closeAll(ctx);
  });

  test("the control PIN is never shown to a phone without control", async ({ browser }) => {
    const uid = uuid();
    const ctxA = await browser.newContext();
    const adminA = await ctxA.newPage();
    await navigateAndWait(adminA, adminURL(uid));
    const ctxB = await browser.newContext();
    const adminB = await ctxB.newPage();
    await navigateAndWait(adminB, adminURL(uid));

    await takeControl(adminA);

    // The onlooker can read the settings screen but not the credential on it.
    await adminB.getByTestId("nav-settings").click();
    await expect(adminB.getByTestId("share-url")).toBeVisible();
    await expect(adminB.getByTestId("control-pin")).toHaveCount(0);

    await closeAll(ctxA, ctxB);
  });

  test("releasing control re-locks every phone", async ({ browser }) => {
    const uid = uuid();
    const ctxA = await browser.newContext();
    const adminA = await ctxA.newPage();
    await navigateAndWait(adminA, adminURL(uid));
    const ctxB = await browser.newContext();
    const adminB = await ctxB.newPage();
    await navigateAndWait(adminB, adminURL(uid));

    await takeControl(adminA);
    const pin = await readControlPin(adminA);
    await enterPin(adminB, pin);
    await expect(adminB.getByTestId("access-banner")).toBeHidden();

    // Either holder may hand the board back for everyone.
    await adminB.getByTestId("nav-settings").click();
    await adminB.getByTestId("release-control").click();

    await expect(adminA.getByTestId("access-banner")).toBeVisible();
    await expect(adminB.getByTestId("access-banner")).toBeVisible();
    await adminA.getByRole("button", { name: "Scoreboard" }).click();
    await expect(adminA.getByTestId("home-plus")).toBeDisabled();

    await closeAll(ctxA, ctxB);
  });

  test("control lapses when its window expires", async ({ browser }) => {
    // This scoreboard has CONTROL_TTL_MS_<uuid>=4000 in playwright.config.ts.
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(EXPIRING));

    await takeControl(admin);
    await expect(admin.getByTestId("home-plus")).toBeEnabled();

    // The banner returns on its own once the window passes.
    await expect(admin.getByTestId("access-banner")).toBeVisible({ timeout: 15_000 });
    await expect(admin.getByTestId("home-plus")).toBeDisabled();

    await closeAll(ctx);
  });

  test("extending pushes the deadline out", async ({ browser }) => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(EXPIRING));

    await takeControl(admin);
    await admin.getByTestId("nav-settings").click();

    // Keep extending across a span several times the 4s window; control holds.
    for (let i = 0; i < 4; i++) {
      await admin.waitForTimeout(1500);
      await admin.getByTestId("extend-control").click();
    }
    await expect(admin.getByTestId("control-pin")).toBeVisible();
    await admin.getByRole("button", { name: "Scoreboard" }).click();
    await expect(admin.getByTestId("home-plus")).toBeEnabled();

    await closeAll(ctx);
  });

  test("a protected slot demands the match code and refuses a claim", async ({ browser }) => {
    // This scoreboard is inside a protected slot at every hour of every day.
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(SLOTTED));

    await expect(admin.getByTestId("access-banner")).toBeVisible();
    // Nothing to take: during a slot the code is compulsory.
    await expect(admin.getByTestId("access-claim")).toHaveCount(0);
    await expect(admin.getByTestId("home-plus")).toBeDisabled();

    await enterPin(admin, SLOT_PIN);
    await expect(admin.getByTestId("access-banner")).toBeHidden();
    await expect(admin.getByTestId("home-plus")).toBeEnabled();

    await closeAll(ctx);
  });

  test("a wrong code is rejected and leaves the phone locked", async ({ browser }) => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(SLOTTED));

    await enterPin(admin, "00000000");
    await expect(admin.getByTestId("access-error")).toBeVisible();
    await expect(admin.getByTestId("access-banner")).toBeVisible();

    await closeAll(ctx);
  });

  test("the TV code unlocks switching and survives a reload", async ({ browser }) => {
    // TV_PINS is configured for this scoreboard; score editing is separate.
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await navigateAndWait(admin, adminURL(CONFIGURED));

    await admin.getByRole("button", { name: "TV" }).click();
    await expect(admin.getByTestId("access-banner")).toBeVisible();

    await enterPin(admin, TV_PIN);
    await expect(admin.getByTestId("access-banner")).toBeHidden();

    // The grant is bound to the phone, so it outlives the page.
    await admin.reload();
    await admin.getByTestId("home-score").waitFor({ state: "visible" });
    await admin.getByRole("button", { name: "TV" }).click();
    await expect(admin.getByTestId("access-banner")).toBeHidden();

    // ...and it does not confer the right to edit the score.
    await admin.getByRole("button", { name: "Scoreboard" }).click();
    await expect(admin.getByTestId("home-plus")).toBeDisabled();

    await closeAll(ctx);
  });

  test("the share QR carries no PIN and opens read-only", async ({ browser }) => {
    const uid = uuid();
    const ctxA = await browser.newContext();
    const adminA = await ctxA.newPage();
    await navigateAndWait(adminA, adminURL(uid));

    await takeControl(adminA);
    await adminA.getByTestId("nav-settings").click();
    const shareUrl = (await adminA.getByTestId("share-url").textContent())!.trim();

    // The shared link is an invitation to watch, not a credential to edit.
    expect(shareUrl).not.toContain("pin=");
    expect(shareUrl).toContain(`uuid=${uid}`);

    const ctxB = await browser.newContext();
    const adminB = await ctxB.newPage();
    await navigateAndWait(adminB, shareUrl);
    await expect(adminB.getByTestId("access-banner")).toBeVisible();
    await expect(adminB.getByTestId("home-plus")).toBeDisabled();

    // ...but it does show the live score.
    await adminA.getByRole("button", { name: "Scoreboard" }).click();
    await adminA.getByTestId("home-plus").click();
    await expect(adminB.getByTestId("home-score")).toHaveText("1");

    await closeAll(ctxA, ctxB);
  });

  test("the display keeps working without any PIN", async ({ browser }) => {
    const uid = uuid();
    const { display, admin1, admin2, ctxDisplay, ctxAdmin1, ctxAdmin2 } =
      await openThreeClients(browser, uid);

    // The big screen holds no device id and can never hold a capability; it
    // must still receive every update.
    await takeControl(admin1);
    await admin1.getByTestId("home-plus").click();
    await expect(display.getByTestId("home-score")).toHaveText("1");

    await closeAll(ctxDisplay, ctxAdmin1, ctxAdmin2);
  });
});
