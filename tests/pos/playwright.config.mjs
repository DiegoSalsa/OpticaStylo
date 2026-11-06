import {defineConfig} from "@playwright/test";
import path from "node:path";
import os from "node:os";
import base from "../prescriptions/playwright.config.mjs";
const output=process.env.PRESCRIPTION_TEST_OUTPUT??path.join(os.tmpdir(),"opticastylo-pos-caja-fase-3");
export default defineConfig({...base,testDir:".",testMatch:"browser.spec.js",outputDir:path.join(output,"pos-artifacts"),reporter:[["list"],["json",{outputFile:path.join(output,"pos-browser.json")}],["html",{outputFolder:path.join(output,"pos-report"),open:"never"}]]});
