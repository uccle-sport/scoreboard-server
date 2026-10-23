import { defineConfig } from "@playwright/test";

// Scoreboards with fixed UUIDs, so per-display env config can be attached to
// them. Tests that need no configuration keep using random UUIDs.
// Kept in step with the constants in e2e/scoreboard.spec.ts.
const CONFIGURED = "e2e00000_0000_4000_8000_000000000001";
const SLOTTED = "e2e00000_0000_4000_8000_000000000002";
const EXPIRING = "e2e00000_0000_4000_8000_000000000003";

const env = [
  "PORT=5050",
  "GDS_SECRET=test-secret",
  // A source PIN series on the configured board, so TV switching can be tested
  // as a separate capability from score editing.
  `TV_PINS_${CONFIGURED}='["11112222"]'`,
  `SIGNAGE_PINS_${CONFIGURED}='["33334444"]'`,
  // Always inside a protected slot, whenever the suite happens to run.
  `PROTECTED_SLOTS_${SLOTTED}='[{"days":"MON-SUN","from":"00:00","to":"24:00","pin":"48127390"}]'`,
  // A control window short enough to watch lapse. Per-display, so it does not
  // shorten the window for every other test against the same server.
  `CONTROL_TTL_MS_${EXPIRING}=4000`,
].join(" ");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 2,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5050",
    trace: "on-first-retry",
  },
  webServer: {
    command: `${env} bun run packages/server/src/index.ts`,
    port: 5050,
    reuseExistingServer: !process.env.CI,
  },
});
