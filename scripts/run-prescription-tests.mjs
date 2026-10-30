import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createCloudinaryMediaGateway } from "../src/integrations/media/cloudinary-media-gateway.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const inventoryMode = process.argv.includes("--inventory");
const output = path.join(os.tmpdir(), inventoryMode ? "opticastylo-inventario-fase-2" : "opticastylo-recetas-fase-1");
const runRoot = path.join(os.tmpdir(), `stylo-prescriptions-${randomBytes(8).toString("hex")}`);
const appRoot = path.join(runRoot, "app");
const pgData = path.join(runRoot, "postgres");
const pgPort = 55441;
const appPort = 3119;
const schema = `stylo_e2e_${randomBytes(8).toString("hex")}`;
// Limitar conexiones evita crear decenas de procesos PostgreSQL simultáneos
// en Windows. Las solicitudes HTTP concurrentes siguen ejecutándose realmente.
const databaseUrl = `postgresql://stylo_test@127.0.0.1:${pgPort}/opticastylo_evaluation?schema=${schema}&connection_limit=5&connect_timeout=15`;
const allowed = /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|userprofile|home|homedrive|homepath|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|allusersprofile|lang|lc_all|ci|playwright_browsers_path)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
Object.assign(env, {
  DATABASE_URL: databaseUrl, STORE_E2E_SCHEMA: schema, EVALUATION_PG_PORT: String(pgPort),
  EVALUATION_HTTP_URL: `http://127.0.0.1:${appPort}`, PRESCRIPTION_TEST_OUTPUT: output,
  STORE_INCLUDE_TEST_DATA: "true", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
  APP_TIME_ZONE: "America/Santiago", EMAIL_MODE: "disabled", OPENAI_PRESCRIPTION_READER_ENABLED: "false",
  MERCADO_PAGO_ACCESS_TOKEN: "", MERCADO_PAGO_MODE: "sandbox", MERCADO_PAGO_PRODUCTION_ENABLED: "false",
  DEPLOYMENT_ENVIRONMENT: "university", UNIVERSITY_INSECURE_HTTP_ALLOWED: "true",
});
// Solo se habilitan proveedores al solicitar pruebas reales de archivos sintéticos.
if (process.argv.includes("--live-storage")) {
  const configuration = nextEnv.loadEnvConfig(root).combinedEnv;
  for (const key of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) env[key] = configuration[key] ?? "";
  env.PRESCRIPTION_LIVE_STORAGE = "true";
}
let server;
let serverOutput = "";
let pgStarted = false;
const pgBin = [process.env.PG_BIN, ...["18", "17", "16", "15"].map((version) => `C:/Program Files/PostgreSQL/${version}/bin`),
  path.resolve(root, "../ESTUDIO-EVALUACION-STYLO/herramientas/pgsql/bin"), "/usr/lib/postgresql/17/bin"]
  .find((candidate) => candidate && existsSync(path.join(candidate, process.platform === "win32" ? "initdb.exe" : "initdb")));
if (!pgBin) throw new Error("No se encontraron las herramientas locales de PostgreSQL.");
const pg = (name) => path.join(pgBin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
async function run(command, args, { cwd = root, record } = {}) {
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let captured = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { captured += chunk; process.stdout.write(chunk); });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (record) await writeFile(path.join(output, record), captured);
  if (code !== 0) throw new Error(`${path.basename(command)} terminó con código ${code}.`);
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer(); listener.once("error", reject);
    listener.listen(port, "127.0.0.1", () => listener.close(resolve));
  });
}
try {
  await freePort(pgPort); await freePort(appPort);
  await mkdir(output, { recursive: true }); await mkdir(appRoot, { recursive: true });
  for (const entry of ["src", "public", "config", "prisma", "package.json", "package-lock.json", "jsconfig.json", "next.config.mjs"]) {
    await cp(path.join(root, entry), path.join(appRoot, entry), { recursive: true });
  }
  await cp(path.join(root, "tests"), path.join(appRoot, "tests"), { recursive: true });
  await cp(path.join(root, "scripts"), path.join(appRoot, "scripts"), { recursive: true });
  await cp(path.join(root, "playwright.evaluation.config.mjs"), path.join(appRoot, "playwright.evaluation.config.mjs"));
  await symlink(path.join(root, "node_modules"), path.join(appRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  console.log("Pruebas de recetas: clúster sintético local; sin conexión a la base configurada en .env.");
  await run(pg("initdb"), ["-D", pgData, "-U", "stylo_test", "-A", "trust", "--encoding=UTF8", "--no-locale"]);
  await run(pg("pg_ctl"), ["start", "-D", pgData, "-l", path.join(runRoot, "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort}`, "-w"]);
  pgStarted = true;
  await run(pg("createdb"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "stylo_test", "opticastylo_evaluation"]);
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: appRoot });
  if (inventoryMode) await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { cwd: appRoot, record: "migration-diff.txt" });
  await run(process.execPath, ["scripts/seed-evaluation.mjs"], { cwd: appRoot });
  await run(process.execPath, ["scripts/seed-inventory-demo.mjs"], { cwd: appRoot });
  await mkdir(path.join(appRoot, "tmp/evaluation"), { recursive: true });
  await writeFile(path.join(appRoot, "tmp/evaluation/runtime.json"), JSON.stringify({ databaseUrl, schema, appPort, pgPort }));
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], { cwd: appRoot, record: "build.txt" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: appRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverOutput += chunk; process.stdout.write(chunk); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("El servidor terminó antes de iniciar las pruebas.");
    try { ready = (await fetch(`${env.EVALUATION_HTTP_URL}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* Esperar arranque. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error("El servidor no inició.");
  if (process.argv.includes("--demo")) {
    console.log(`Demostración local con datos sintéticos: ${env.EVALUATION_HTTP_URL}`);
    console.log("Cierre con Ctrl+C para detener y eliminar el clúster de demostración.");
    await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } else {
  if (inventoryMode) {
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/unit/rut.test.js", "tests/unit/appointment-validation.test.js", "tests/unit/availability-engine.test.js", "tests/unit/password.test.js", "tests/integration/evaluation.test.js"], { cwd: appRoot, record: "academicas.txt" });
    await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "playwright.evaluation.config.mjs"], { cwd: appRoot, record: "academicas-e2e.txt" });
    await cp(path.join(appRoot, "tmp/evaluation"), path.join(output, "academic-artifacts"), { recursive: true });
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/inventory/flow.test.js"], { cwd: appRoot, record: "inventory.txt" });
  }
  await run(process.execPath, ["--test", "--test-concurrency=1", "tests/prescriptions/validation.test.js", "tests/prescriptions/flow.test.js"], { cwd: appRoot, record: "tests.txt" });
  await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "tests/prescriptions/playwright.config.mjs"], { cwd: appRoot, record: "browser.txt" });
  if (inventoryMode) await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "tests/inventory/playwright.config.mjs"], { cwd: appRoot, record: "inventory-browser.txt" });
  }
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (inventoryMode && existsSync(path.join(appRoot, "tmp/evaluation"))) await cp(path.join(appRoot, "tmp/evaluation"), path.join(output, "academic-artifacts"), { recursive: true });
  if (server?.exitCode === null) { const exited = new Promise((resolve) => server.once("exit", resolve)); server.kill(); await exited; }
  if (existsSync(output)) await writeFile(path.join(output, "server.txt"), serverOutput);
  if (pgStarted) {
    const database = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const assets = await database.external_prescriptions.findMany({ where: { cloudinary_asset_id: { not: null } } });
      if (assets.length) {
        const gateway = createCloudinaryMediaGateway({ environment: env });
        for (const row of assets) if (!await gateway.deletePrivatePrescription({ publicId: row.cloudinary_public_id })) {
          console.error("No se pudo limpiar un archivo sintético:", row.cloudinary_asset_id); process.exitCode = 1;
        }
      }
    } catch (error) {
      console.error("No se pudo completar la limpieza de archivos sintéticos:", error.code ?? error.message); process.exitCode = 1;
    } finally {
      await database.$disconnect();
      await run(pg("pg_ctl"), ["stop", "-D", pgData, "-m", "fast", "-w"]);
      await writeFile(path.join(output, "postgres.txt"), await readFile(path.join(runRoot, "postgres.log")));
    }
  }
  if (path.dirname(runRoot) !== os.tmpdir() || !/^stylo-prescriptions-[a-f0-9]{16}$/.test(path.basename(runRoot))) throw new Error("Ruta temporal no autorizada.");
  await rm(runRoot, { recursive: true, force: true });
  console.log("Entorno de recetas eliminado; las pruebas académicas y su entorno se conservaron.");
}
