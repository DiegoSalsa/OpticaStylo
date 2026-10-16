import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "evaluation.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "tmp/evaluation/artifacts",
  reporter: [
    ["list"],
    ["json", { outputFile: "tmp/evaluation/e2e-results.json" }],
    ["html", { outputFolder: "tmp/evaluation/playwright-report", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3117",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [{ name: "evaluacion-chromium" }],
  // El runner administra PostgreSQL y Next.js también en Windows, donde
  // Playwright webServer no admite cierre mediante SIGTERM/SIGINT.
});
