import {defineConfig} from "@playwright/test";
import path from "node:path";
import base from "../shipping/playwright.config.mjs";
const output=process.env.PRESCRIPTION_TEST_OUTPUT;
export default defineConfig({...base,testDir:"../..",testMatch:["**/tests/reconciliation/browser.spec.js","**/e2e/demo-regression.spec.js"],grep:/buscador del encabezado|catálogo:|reserva: limpiar|inventario confirmado|reportes: exportar/,outputDir:path.join(output,"reconciliation-artifacts"),reporter:[["list"],["json",{outputFile:path.join(output,"reconciliation-browser.json")}]]});
