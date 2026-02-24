import { defineConfig } from "@playwright/test";

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
    command: "PORT=5050 GDS_SECRET=test-secret node packages/server/dist/index.js",
    port: 5050,
    reuseExistingServer: !process.env.CI,
  },
});
