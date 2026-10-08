import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es necesaria para crear el esquema aislado de pruebas.");
const schema = `stylo_e2e_${randomBytes(8).toString("hex")}`;
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.set("schema", schema);
const env = { ...process.env, DATABASE_URL: databaseUrl.href, STORE_E2E_SCHEMA: schema,
  OPTICASTYLO_BUILD_DIR: `tmp/store-e2e/build-${schema}`,
  STORE_INCLUDE_TEST_DATA: "true", VERCEL_ENV: "preview", OPENAI_PRESCRIPTION_READER_ENABLED: "false",
  MERCADO_PAGO_ACCESS_TOKEN: "", STORE_E2E_BASE_URL: "http://localhost:3107" };
const admin = new PrismaClient();
let server;
function run(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...env, ...extraEnv }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${args[0]} terminó con código ${code}.`)));
  });
}
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  console.log(`Pruebas en esquema aislado: ${schema}. Los datos existentes no se modifican.`);
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  await mkdir("tmp/store-e2e", { recursive: true });
  await writeFile("tmp/store-e2e/isolated-env.json", JSON.stringify({ schema }));
  await run(["node_modules/next/dist/bin/next", "build"], { NODE_ENV: "production" });
  await run(["--test", "tests/integration/store-guest-checkout.test.js"], { NODE_ENV: "test" });
  await run(["scripts/seed-store-e2e.mjs"], { NODE_ENV: "test" });
  if (process.env.MERCADO_PAGO_MODE === "sandbox" && process.env.MERCADO_PAGO_ACCESS_TOKEN
    && process.env.MERCADO_PAGO_PRODUCTION_ENABLED !== "true") {
    await run(["scripts/verify-store-sandbox-checkout.mjs"], {
      NODE_ENV: "test", MERCADO_PAGO_ACCESS_TOKEN: process.env.MERCADO_PAGO_ACCESS_TOKEN,
    });
  }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3107"], {
    env: { ...env, NODE_ENV: "production" }, stdio: "inherit",
  });
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try { ready = (await fetch(`${env.STORE_E2E_BASE_URL}/api/health`)).ok; } catch { /* Esperar el arranque. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("El servidor de pruebas no inició.");
  await run(["node_modules/playwright/cli.js", "test", "--config", "playwright.config.mjs",
    ...(process.env.STORE_E2E_GREP ? ["--grep", process.env.STORE_E2E_GREP] : []),
  ]);
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  // Solo este nombre, creado por la ejecución actual, puede eliminarse.
  if (!/^stylo_e2e_[0-9a-f]{16}$/.test(schema)) throw new Error("Esquema no autorizado para limpieza.");
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
