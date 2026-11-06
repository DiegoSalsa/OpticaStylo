import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "../shipping/playwright.config.mjs";
const output=process.env.PRESCRIPTION_TEST_OUTPUT;
export default defineConfig({...base,testDir:".",testMatch:"browser.spec.js",outputDir:path.join(output,"release-artifacts"),reporter:[["list"],["json",{outputFile:path.join(output,"release-browser.json")}]]});
