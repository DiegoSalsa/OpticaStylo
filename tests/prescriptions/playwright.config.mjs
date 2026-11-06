import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const output = process.env.PRESCRIPTION_TEST_OUTPUT ?? path.join(os.tmpdir(), "opticastylo-recetas-fase-1");

export default defineConfig({
  testDir: ".", testMatch: "browser.spec.js", workers: 1, retries: 0,
  timeout: 90_000, expect: { timeout: 15_000 },
  outputDir: path.join(output, "artifacts"),
  reporter: [["list"], ["json", { outputFile: path.join(output, "browser.json") }],
    ["html", { outputFolder: path.join(output, "report"), open: "never" }]],
  use: { baseURL: process.env.EVALUATION_HTTP_URL, channel: process.platform === "win32" ? "msedge" : undefined,
    screenshot: "on", trace: "retain-on-failure" },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    { name: "movil", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
