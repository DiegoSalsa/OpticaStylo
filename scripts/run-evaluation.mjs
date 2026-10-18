import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const mode = process.argv[2] ?? "all";
if (!["all", "integration", "e2e", "ui", "server"].includes(mode)) throw new Error("Modo esperado: all, integration, e2e, ui o server.");
const output = path.join(root, "tmp", "evaluation");
const runId = randomBytes(8).toString("hex");
const runDirectory = path.join(output, `run-${runId}`);
const pgData = path.join(runDirectory, "postgres");
const schema = `stylo_e2e_${runId}`;
const pgPort = Number(process.env.EVALUATION_PG_PORT ?? "55439");
if (!Number.isInteger(pgPort) || pgPort < 1024 || pgPort > 65535) throw new Error("EVALUATION_PG_PORT debe ser un puerto local válido.");
const appPort = Number(process.env.EVALUATION_APP_PORT ?? "3117");
if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535 || appPort === pgPort) throw new Error("EVALUATION_APP_PORT debe ser un puerto local válido distinto al de PostgreSQL.");
const baseURL = `http://127.0.0.1:${appPort}`;
const databaseUrl = `postgresql://stylo_test@127.0.0.1:${pgPort}/opticastylo_evaluation?schema=${schema}`;

// No heredar DATABASE_URL, secretos, NODE_OPTIONS ni cargar los .env del proyecto.
const osVariables = new Set([
  "path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir",
  "userprofile", "home", "homedrive", "homepath", "appdata", "localappdata", "programfiles",
  "programfiles(x86)", "programdata", "allusersprofile", "lang", "lc_all", "ci",
  "playwright_browsers_path",
]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => osVariables.has(key.toLowerCase())));
Object.assign(env, {
  DATABASE_URL: databaseUrl, STORE_E2E_SCHEMA: schema, EVALUATION_HTTP_URL: baseURL, EVALUATION_PG_PORT: String(pgPort),
  STORE_INCLUDE_TEST_DATA: "true", STORE_E2E_BROWSER_CHANNEL: process.env.STORE_E2E_BROWSER_CHANNEL,
  OPTICASTYLO_BUILD_DIR: "tmp/evaluation/build", NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "production", EMAIL_MODE: "disabled", OPENAI_PRESCRIPTION_READER_ENABLED: "false",
  MERCADO_PAGO_ACCESS_TOKEN: "", MERCADO_PAGO_PRODUCTION_ENABLED: "false",
  // Usa la configuración HTTP local ya existente, sin modificar cookies de la aplicación.
  DEPLOYMENT_ENVIRONMENT: "university", UNIVERSITY_INSECURE_HTTP_ALLOWED: "true",
});

// Next.js lee .env incluso al compilar. Exigir un checkout sin secretos locales evita mezclarlos.
for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  if (existsSync(path.join(root, file))) throw new Error(`Usa un checkout de pruebas sin ${file}; no se leerán credenciales locales.`);
}

let pgBin;
let postgresStarted = false;
let runtimeWritten = false;
let server;
let activeChild;
let stopping;
let releaseServer;

async function findPostgres() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const candidates = process.env.PG_BIN ? [process.env.PG_BIN] : [
    ...["18", "17", "16", "15", "14"].map((version) => process.platform === "win32"
      ? `C:/Program Files/PostgreSQL/${version}/bin` : `/usr/lib/postgresql/${version}/bin`),
    ...["/opt/homebrew/opt/postgresql@17/bin", "/usr/local/opt/postgresql@17/bin"],
    ...(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter),
  ];
  const directory = candidates.find((candidate) => existsSync(path.join(candidate, `initdb${suffix}`))
    && existsSync(path.join(candidate, `pg_ctl${suffix}`)) && existsSync(path.join(candidate, `createdb${suffix}`)));
  if (!directory) throw new Error("Faltan initdb/pg_ctl/createdb de PostgreSQL. Instala PostgreSQL 17 o define PG_BIN con su directorio bin.");
  return directory;
}

function pgExecutable(name) { return path.join(pgBin, `${name}${process.platform === "win32" ? ".exe" : ""}`); }

async function assertFreePort(port) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", () => reject(new Error(`El puerto local ${port} está ocupado; cierra la ejecución de evaluación anterior.`)));
    listener.listen(port, "127.0.0.1", () => listener.close(resolve));
  });
}

async function run(command, args, { nodeEnv = "test", record } = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...env, NODE_ENV: nodeEnv }, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"] });
  activeChild = child;
  let captured = "";
  child.stdout.on("data", (chunk) => { captured += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { captured += chunk; process.stderr.write(chunk); });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  activeChild = undefined;
  if (record) await writeFile(path.join(output, record), captured);
  if (code !== 0) throw new Error(`${path.basename(command)} ${args[0]} terminó con código ${code}.`);
}

async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    for (const child of [activeChild, server]) {
      if (child && child.exitCode === null && !child.killed) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        await exited;
      }
    }
    if (postgresStarted) {
      await run(pgExecutable("pg_ctl"), ["stop", "-D", pgData, "-m", "fast", "-w"]);
      postgresStarted = false;
    }
    if (runtimeWritten) {
      const runtime = JSON.parse(await readFile(path.join(output, "runtime.json"), "utf8"));
      if (runtime.schema === schema) await rm(path.join(output, "runtime.json"));
    }
    // El único borrado recursivo apunta al directorio aleatorio creado por esta ejecución.
    if (path.dirname(runDirectory) !== output || !/^run-[0-9a-f]{16}$/.test(path.basename(runDirectory))) {
      throw new Error("Directorio de limpieza no autorizado.");
    }
    await rm(runDirectory, { recursive: true, force: true });
    console.log("Limpieza verificada: servidor y PostgreSQL detenidos; clúster sintético eliminado.");
  })();
  return stopping;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { void stop().then(() => { releaseServer?.(); process.exit(0); }, (error) => {
    console.error(error); process.exit(1);
  }); });
}

try {
  pgBin = await findPostgres();
  await assertFreePort(pgPort);
  await assertFreePort(appPort);
  // Una segunda ejecución no pisa los datos de la que sigue activa.
  if (existsSync(path.join(output, "runtime.json"))) throw new Error("Hay una ejecución interrumpida. Ejecuta npm run test:evaluation:clean antes de continuar.");
  await mkdir(runDirectory, { recursive: true });
  if (mode === "all") {
    await run(process.execPath, ["--test", "tests/utils/chilean-rut.test.js", "tests/validations/appointment-validation.test.js",
      "tests/services/availability-engine.test.js", "tests/auth/password.test.js"], { record: "unit-results.txt" });
  }
  console.log(`Evaluación aislada: PostgreSQL 127.0.0.1:${pgPort}, esquema ${schema}.`);
  await run(pgExecutable("initdb"), ["-D", pgData, "-U", "stylo_test", "-A", "trust", "--encoding=UTF8", "--no-locale"]);
  const socketOption = process.platform === "win32" ? "" : ` -k ${runDirectory}`;
  await run(pgExecutable("pg_ctl"), ["start", "-D", pgData, "-l", path.join(runDirectory, "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${pgPort}${socketOption}`, "-w"]);
  postgresStarted = true;
  await run(pgExecutable("createdb"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "stylo_test", "opticastylo_evaluation"]);
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  await run(process.execPath, ["scripts/seed-evaluation.mjs"]);
  await writeFile(path.join(output, "runtime.json"), JSON.stringify({ databaseUrl, schema, appPort, pgPort }));
  runtimeWritten = true;
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], { nodeEnv: "production", record: "build-results.txt" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const serverErrors = [];
  server.once("error", (error) => serverErrors.push(error));
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => process.stdout.write(chunk));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverErrors.length || server.exitCode !== null) throw serverErrors[0] ?? new Error("Next.js terminó antes de estar disponible.");
    try { ready = (await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Esperar arranque local. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error("El servidor de evaluación no inició.");
  console.log(`Servidor de evaluación listo: ${baseURL}`);
  if (mode === "server") {
    await new Promise((resolve, reject) => {
      releaseServer = resolve;
      server.once("exit", (code) => stopping ? resolve() : reject(new Error(`Next.js terminó inesperadamente (${code}).`)));
    });
  } else {
    if (["all", "integration"].includes(mode)) {
      await run(process.execPath, ["--test", "tests/http/evaluation.test.js"], { record: "integration-results.txt" });
    }
    if (["all", "e2e", "ui"].includes(mode)) {
      await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "playwright.evaluation.config.mjs",
        ...(mode === "ui" ? ["--ui"] : []), ...process.argv.slice(3)], {
        record: "e2e-results.txt",
      });
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stop();
}
