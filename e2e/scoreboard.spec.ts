import { test, expect, type Page, type Browser } from "@playwright/test";

const SECRET = "test-secret";

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
});
