import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import base from "../prescriptions/playwright.config.mjs";
const output = process.env.PRESCRIPTION_TEST_OUTPUT ?? path.join(os.tmpdir(), "opticastylo-inventario-fase-2");
export default defineConfig({ ...base, testDir: ".", testMatch: "browser.spec.js", outputDir: path.join(output,"inventory-artifacts"),
  reporter: [["list"], ["json",{outputFile:path.join(output,"inventory-browser.json")}], ["html",{outputFolder:path.join(output,"inventory-report"),open:"never"}]],
});
