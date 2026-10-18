import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir:"./e2e",testMatch:"academic-critical-flows.spec.js",workers:1,fullyParallel:false,timeout:60000,
  reporter:[["list"],["json",{outputFile:process.env.STORE_E2E_REPORT_PATH??path.join(process.env.ACADEMIC_EVIDENCE_DIR??"tmp/academic-validation","playwright-results.json")}]],
  outputDir:"tmp/academic-validation/playwright-artifacts",
  use:{baseURL:process.env.STORE_E2E_BASE_URL,channel:process.env.STORE_E2E_BROWSER_CHANNEL,headless:true,viewport:{width:1440,height:1000},
    timezoneId:"America/Santiago",trace:"retain-on-failure",screenshot:"only-on-failure"},
});
