import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", fullyParallel: false, workers: 1, timeout: 60000,
  reporter: [["list"], ["json", { outputFile: "tmp/store-e2e/results.json" }]],
  outputDir: `tmp/store-e2e/artifacts-${process.env.STORE_E2E_SCHEMA ?? "local"}`,
  use: {
    baseURL: process.env.STORE_E2E_BASE_URL ?? "http://localhost:3107",
    channel: process.env.STORE_E2E_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined),
    trace: "retain-on-failure", screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
