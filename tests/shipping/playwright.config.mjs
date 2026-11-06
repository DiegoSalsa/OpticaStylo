import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import base from "../prescriptions/playwright.config.mjs";
const output=process.env.PRESCRIPTION_TEST_OUTPUT;
export default defineConfig({ ...base, testDir:".", testMatch:"browser.spec.js", timeout:120000,
  use: { ...base.use, actionTimeout: 15000, navigationTimeout: 30000 },
  outputDir:path.join(output,"shipping-artifacts"),reporter:[["list"],["json",{outputFile:path.join(output,"shipping-browser.json")}],["html",{outputFolder:path.join(output,"shipping-report"),open:"never"}]],
  projects:[{name:"escritorio",use:{...devices["Desktop Chrome"],viewport:{width:1440,height:1000}}},{name:"movil",use:{...devices["iPhone 13"],defaultBrowserType:"chromium"}}],
});
