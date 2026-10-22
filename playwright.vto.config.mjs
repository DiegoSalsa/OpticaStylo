import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "vto-recovery.spec.js", workers: 1, timeout: 90000,
  reporter: [["list"], ["json", { outputFile: "tmp/vto-e2e/results.json" }]],
  outputDir: "tmp/vto-e2e/artifacts",
  use: { baseURL: process.env.VTO_BASE_URL ?? "http://localhost:3119",
    channel: process.platform === "win32" ? "msedge" : undefined,
    acceptDownloads: true, trace: "off" },
});
