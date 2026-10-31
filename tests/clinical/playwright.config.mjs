import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import base from "../prescriptions/playwright.config.mjs";
const output = process.env.PRESCRIPTION_TEST_OUTPUT;
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "browser.spec.js",
  timeout: 120000,
  outputDir: path.join(output, "clinical-artifacts"),
  reporter: [["list"], ["json", {
    outputFile: path.join(output, "clinical-browser.json")
  }], ["html", {
    outputFolder: path.join(output, "clinical-report"),
    open: "never"
  }]],
  projects: [{
    name: "escritorio",
    use: {
      ...devices["Desktop Chrome"],
      viewport: {
        width: 1440,
        height: 1000
      }
    }
  }, {
    name: "tablet",
    use: {
      ...devices["iPad (gen 7)"],
      defaultBrowserType: "chromium"
    }
  }]
});
