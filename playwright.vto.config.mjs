import { defineConfig } from "@playwright/test";
import path from "node:path";
const output=process.env.PRESCRIPTION_TEST_OUTPUT ?? "tmp/vto-e2e";

export default defineConfig({
  testDir: "./e2e", testMatch: "vto-recovery.spec.js", workers: 1, timeout: 90000,
  reporter: [["list"], ["json", { outputFile: path.join(output,"vto-browser.json") }]],
  outputDir: path.join(output,"vto-artifacts"),
  use: { baseURL: process.env.VTO_BASE_URL ?? "http://localhost:3119",
    channel: process.platform === "win32" ? "msedge" : undefined,
    acceptDownloads: true, trace: "off" },
});
