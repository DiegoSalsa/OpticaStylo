import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const statePath = path.resolve("tmp/academic-validation/local-state.json");
export const image = "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";

export async function sanitizedEnvironment(state) {
  const environment = {};
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "COMSPEC", "PATHEXT"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  // Las variables vacías prevalecen sobre .env* en Next. Solo se lee el ejemplo público.
  for (const line of (await readFile(".env.example", "utf8")).split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) environment[match[1]] = "";
  }
  return { ...environment, DATABASE_URL: state.databaseUrl, ACADEMIC_ISOLATION: "true",
    STORE_E2E_SCHEMA: state.schema, STORE_INCLUDE_TEST_DATA: "true",
    STORE_E2E_BASE_URL: `http://127.0.0.1:${state.appPort}`,
    STORE_E2E_BROWSER_CHANNEL: process.platform === "win32" ? "msedge" : undefined,
    OPTICASTYLO_BUILD_DIR: "tmp/academic-validation/build", APP_TIME_ZONE: "America/Santiago",
    VERCEL_ENV: "preview", DEPLOYMENT_ENVIRONMENT: "academic-isolated", NEXT_TELEMETRY_DISABLED: "1",
    EMAIL_MODE: "disabled", EMAIL_DOMAIN_VERIFIED: "false", OPENAI_PRESCRIPTION_READER_ENABLED: "false",
    MERCADO_PAGO_MODE: "sandbox", MERCADO_PAGO_PRODUCTION_ENABLED: "false",
    STORE_E2E_EXTERNAL_MEDIA: "disabled",
    CUSTOMER_PATIENT_OTP_SECRET: state.localOtpSecret,
  };
}

export async function readState() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const url = new URL(state.databaseUrl);
  if (!/^[0-9a-f]{16}$/.test(state.runId) || state.container !== `stylo-academic-${state.runId}`
    || url.hostname !== "127.0.0.1" || url.pathname !== `/stylo_academic_${state.runId}`
    || url.searchParams.get("schema") !== state.schema || state.schema !== `stylo_e2e_${state.runId}`) {
    throw new Error("Estado local de aislamiento inválido. No se permite usar una base existente.");
  }
  const inspect = await execute("docker", ["inspect", "--format", "{{ index .Config.Labels \"org.opticastylo.academic-run\" }}", state.container]);
  if (inspect.output.trim() !== state.runId) throw new Error("El contenedor no pertenece a esta ejecución.");
  return state;
}

export function execute(command, args, environment = process.env, logPath) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (logPath) await writeFile(logPath, output);
      const result = { code, output, durationMs: Date.now() - started };
      if (code !== 0) {
        const error = new Error(`Falló ${path.basename(command)} (código ${code}).`);
        error.result = result;
        reject(error);
      } else resolve(result);
    });
  });
}

export async function prepareIsolation(evidenceDir) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const runId = randomBytes(8).toString("hex");
  const container = `stylo-academic-${runId}`;
  const database = `stylo_academic_${runId}`;
  const password = randomBytes(32).toString("hex");
  const environmentFile = path.resolve(`tmp/academic-validation/postgres-${runId}.env`);
  await writeFile(environmentFile, `POSTGRES_USER=stylo_test\nPOSTGRES_DB=${database}\nPOSTGRES_PASSWORD=${password}\n`);
  await execute("docker", ["run", "--detach", "--name", container,
    "--label", `org.opticastylo.academic-run=${runId}`, "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql/data:rw", "--env-file", environmentFile, image]);
  const published = await execute("docker", ["port", container, "5432/tcp"]);
  const port = Number(published.output.trim().split(":").at(-1));
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await execute("docker", ["exec", container, "pg_isready", "-U", "stylo_test", "-d", database]); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("El PostgreSQL aislado no inició.");
  const state = { runId, container, database, port, schema: `stylo_e2e_${runId}`, appPort: 3117,
    databaseUrl: `postgresql://stylo_test:${password}@127.0.0.1:${port}/${database}?schema=stylo_e2e_${runId}`,
    evidenceDir: path.resolve(evidenceDir), localOtpSecret: randomBytes(32).toString("hex") };
  await writeFile(statePath, JSON.stringify(state, null, 2));
  const environment = await sanitizedEnvironment(state);
  const migration = await execute(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], environment,
    path.join(evidenceDir, "preparacion-migraciones.log"));
  const version = await execute("docker", ["exec", container, "psql", "-U", "stylo_test", "-d", database, "-Atc", "SELECT version();"]);
  await writeFile(path.join(evidenceDir, "aislamiento.json"), JSON.stringify({
    preparedAt: new Date().toISOString(), runId, container, database, host: "127.0.0.1", port,
    schema: state.schema, image, postgres: version.output.trim(), node: process.version,
    migrationDurationMs: migration.durationMs, externalProviderCredentials: false,
    storage: "tmpfs nuevo sin volumen existente", localCredentialFile: "tmp/academic-validation/local-state.json (ignorado)",
  }, null, 2));
  return state;
}
