import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { createCloudinaryMediaGateway } from "../src/integrations/media/cloudinary-media-gateway.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const gitValue=args=>spawnSync("git",args,{cwd:root,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","ignore"]}).stdout?.trim();
const provenance={branch:gitValue(["branch","--show-current"])||"detached",commit:gitValue(["rev-parse","HEAD"])||"unavailable",dirty:Boolean(gitValue(["status","--porcelain"]))};
if(process.argv.includes("--demo") && (provenance.dirty || provenance.commit==="unavailable"))throw new Error("La demostración reconciliada exige una revisión Git identificada y sin cambios pendientes.");
const releaseMode = process.argv.includes("--release");
const shippingMode = process.argv.includes("--shipping") || releaseMode;
const customersOnly=process.argv.includes("--customers-only");
const customersMode=process.argv.includes("--customers")||customersOnly||shippingMode;
const clinicalOnly = process.argv.includes("--clinical-only")||customersOnly;
const clinicalMode = process.argv.includes("--clinical") || clinicalOnly || customersMode;
const posMode = process.argv.includes("--pos") || clinicalMode;
const inventoryMode = process.argv.includes("--inventory") || posMode;
const output = path.join(os.tmpdir(), releaseMode?(process.argv.includes("--demo")?"opticastylo-demo-main-reconciliada":"opticastylo-main-reconciliada"):shippingMode?"opticastylo-despachos-fase-6":customersMode?"opticastylo-clientes-fase-5":clinicalMode ? "opticastylo-clinica-fase-4" : posMode ? "opticastylo-pos-caja-fase-3" : inventoryMode ? "opticastylo-inventario-fase-2" : "opticastylo-recetas-fase-1");
const runRoot = path.join(os.tmpdir(), `stylo-prescriptions-${randomBytes(8).toString("hex")}`);
const appRoot = path.join(runRoot, "app");
const pgData = path.join(runRoot, "postgres");
const pgPort = releaseMode ? 55481 : shippingMode ? 55461 : 55441;
const appPort = releaseMode ? 3149 : shippingMode ? 3129 : 3119;
const schema = `stylo_e2e_${randomBytes(8).toString("hex")}`;
// Limitar conexiones evita crear decenas de procesos PostgreSQL simultáneos
// en Windows. Las solicitudes HTTP concurrentes siguen ejecutándose realmente.
const databaseUrl = `postgresql://stylo_test@127.0.0.1:${pgPort}/opticastylo_evaluation?schema=${schema}&connection_limit=5&connect_timeout=15`;
const allowed = /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|userprofile|home|homedrive|homepath|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|allusersprofile|lang|lc_all|ci|playwright_browsers_path)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
if(process.env.VTO_PORTRAIT_PATH) {
  const portrait=await readFile(process.env.VTO_PORTRAIT_PATH);
  if(createHash("sha256").update(portrait).digest("hex")!=="a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e")throw new Error("El fixture del probador debe ser el retrato público verificado de MediaPipe.");
  env.VTO_PORTRAIT_PATH=path.resolve(process.env.VTO_PORTRAIT_PATH);
}
Object.assign(env, {
  DATABASE_URL: databaseUrl, STORE_E2E_SCHEMA: schema, EVALUATION_PG_PORT: String(pgPort),
  EVALUATION_HTTP_URL: `http://127.0.0.1:${appPort}`, PRESCRIPTION_TEST_OUTPUT: output,
  STORE_E2E_BASE_URL:`http://127.0.0.1:${appPort}`,
  STORE_INCLUDE_TEST_DATA: "true", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
  APP_TIME_ZONE: "America/Santiago", EMAIL_MODE: "disabled", OPENAI_PRESCRIPTION_READER_ENABLED: "false",
  DEPLOYMENT_VERSION:provenance.commit.slice(0,12),
  MERCADO_PAGO_ACCESS_TOKEN: "", MERCADO_PAGO_MODE: "sandbox", MERCADO_PAGO_PRODUCTION_ENABLED: "false",
  POS_CASH_TEST_MODE: posMode ? "true" : "false",
  CLINICAL_TEST_MODE: clinicalMode ? "true" : "false",
  CHILEXPRESS_MODE: shippingMode ? "synthetic" : "disabled", CHILEXPRESS_SYNTHETIC_ALLOWED: shippingMode ? "true" : "false",
  OPERATIONS_ENABLED: releaseMode ? "true" : "false", CRON_SECRET: releaseMode ? randomBytes(32).toString("hex") : "",
  CUSTOMER_COMMERCIAL_TEST_MODE:customersMode?"true":"false",
  CUSTOMER_COMMERCE_TEST_MAILBOX:customersMode?"true":"false",
  CUSTOMER_COMMERCE_OTP_SECRET:randomBytes(32).toString("hex"),
  CLINICAL_DEMO_MODE: clinicalMode && process.argv.includes("--demo") ? "true" : "false",
  DEPLOYMENT_ENVIRONMENT: "university", UNIVERSITY_INSECURE_HTTP_ALLOWED: "true",
});
// Solo se habilitan proveedores al solicitar pruebas reales de archivos sintéticos.
if (process.argv.includes("--live-storage")) {
  if(posMode) throw new Error("La fase 3 utiliza exclusivamente credenciales sintéticas; no habilite proveedores reales.");
  const configuration = nextEnv.loadEnvConfig(root).combinedEnv;
  for (const key of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) env[key] = configuration[key] ?? "";
  env.PRESCRIPTION_LIVE_STORAGE = "true";
}
let server;
let vtoServer;
let serverOutput = "";
let vtoOutput = "";
let pgStarted = false;
const pgConfig = spawnSync("pg_config", ["--bindir"], {encoding:"utf8",windowsHide:true}).stdout?.trim();
const pgBin = [process.env.PG_BIN, pgConfig, ...["18", "17", "16", "15"].map((version) => `C:/Program Files/PostgreSQL/${version}/bin`),
  path.resolve(root, "../ESTUDIO-EVALUACION-STYLO/herramientas/pgsql/bin"), "/usr/lib/postgresql/17/bin"]
  .find((candidate) => candidate && existsSync(path.join(candidate, process.platform === "win32" ? "initdb.exe" : "initdb")));
if (!pgBin) throw new Error("No se encontraron las herramientas locales de PostgreSQL.");
env.RC_PG_BIN = pgBin; env.RC_REPOSITORY_ROOT = root;
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
  await writeFile(path.join(output,"source.json"),JSON.stringify({...provenance,url:env.EVALUATION_HTTP_URL},null,2));
  console.log(`Código reconciliado: ${provenance.branch} @ ${provenance.commit}; cambios pendientes: ${provenance.dirty}.`);
  for (const entry of ["src", "public", "config", "prisma", "package.json", "package-lock.json", "jsconfig.json", "next.config.mjs"]) {
    await cp(path.join(root, entry), path.join(appRoot, entry), { recursive: true });
  }
  await cp(path.join(root, "tests"), path.join(appRoot, "tests"), { recursive: true });
  await cp(path.join(root, "e2e"), path.join(appRoot, "e2e"), { recursive: true });
  await cp(path.join(root, "scripts"), path.join(appRoot, "scripts"), { recursive: true });
  if (shippingMode) {
    // The earlier phases' assertions use a fixed loopback port. Adapt only the
    // disposable copies, leaving their sources and the ten academic cases intact.
    const { readdir } = await import("node:fs/promises");
    async function adaptTestPort(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await adaptTestPort(file);
        else if (/\.(js|mjs)$/.test(entry.name)) {
          const source = await readFile(file, "utf8");
          if (source.includes(":3119")) await writeFile(file, source.replaceAll(":3119", `:${appPort}`));
        }
      }
    }
    await adaptTestPort(path.join(appRoot, "tests"));
  }
  await cp(path.join(root, "playwright.evaluation.config.mjs"), path.join(appRoot, "playwright.evaluation.config.mjs"));
  await cp(path.join(root, "playwright.vto.config.mjs"), path.join(appRoot, "playwright.vto.config.mjs"));
  await symlink(path.join(root, "node_modules"), path.join(appRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  console.log("Pruebas de recetas: clúster sintético local; sin conexión a la base configurada en .env.");
  await run(pg("initdb"), ["-D", pgData, "-U", "stylo_test", "-A", "trust", "--encoding=UTF8", "--no-locale"]);
  // El clúster de pruebas solo se usa por TCP. Evita el socket del sistema en Linux.
  const socketOption = process.platform === "win32" ? "" : " -c unix_socket_directories=";
  await run(pg("pg_ctl"), ["start", "-D", pgData, "-l", path.join(runRoot, "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${pgPort}${socketOption}`, "-w"]);
  pgStarted = true;
  await run(pg("createdb"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "stylo_test", "opticastylo_evaluation"]);
  if(releaseMode) await run(process.execPath,["scripts/verify-release-migrations.mjs",...(process.argv.includes("--write-reference")?["--write-reference"]:[])],{cwd:appRoot,record:"migration-certificate.txt"});
  if(!process.argv.includes("--migrations-only")) {
  if(releaseMode) await rename(path.join(appRoot,"prisma/migrations/20261106010000_legacy_migration_ledger"),path.join(runRoot,"ledger-migration"));
  if(shippingMode) await rename(path.join(appRoot,"prisma/migrations/20261106000000_shipping_chilexpress"),path.join(runRoot,"shipping-migration"));
  if(clinicalMode){
    await rename(path.join(appRoot,"prisma/migrations/20261031000000_customer_commercial_profile"),path.join(runRoot,"customer-migration"));
    await rename(path.join(appRoot,"prisma/migrations/20261030020000_clinical_forms"),path.join(runRoot,"clinical-migration"));
    await run(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{cwd:appRoot});
    await run(process.execPath,["scripts/verify-clinical-upgrade.mjs","before"],{cwd:appRoot});
    await rename(path.join(runRoot,"clinical-migration"),path.join(appRoot,"prisma/migrations/20261030020000_clinical_forms"));
  }
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: appRoot });
  if(clinicalMode) await run(process.execPath,["scripts/verify-clinical-upgrade.mjs","after"],{cwd:appRoot,record:"clinical-upgrade.txt"});
  if(clinicalMode){
    if(customersMode)await run(process.execPath,["scripts/verify-customer-upgrade.mjs","before"],{cwd:appRoot});
    await rename(path.join(runRoot,"customer-migration"),path.join(appRoot,"prisma/migrations/20261031000000_customer_commercial_profile"));
    await run(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{cwd:appRoot});
    if(customersMode)await run(process.execPath,["scripts/verify-customer-upgrade.mjs","after"],{cwd:appRoot,record:"customer-upgrade.txt"});
  }
  if(shippingMode){
    await run(process.execPath,["scripts/verify-shipping-upgrade.mjs","before"],{cwd:appRoot});
    await rename(path.join(runRoot,"shipping-migration"),path.join(appRoot,"prisma/migrations/20261106000000_shipping_chilexpress"));
    await run(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{cwd:appRoot});
    await run(process.execPath,["scripts/verify-shipping-upgrade.mjs","after"],{cwd:appRoot,record:"shipping-upgrade.txt"});
  }
  if(releaseMode) {
    await rename(path.join(runRoot,"ledger-migration"),path.join(appRoot,"prisma/migrations/20261106010000_legacy_migration_ledger"));
    await run(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{cwd:appRoot});
  }
  if (inventoryMode) await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { cwd: appRoot, record: "migration-diff.txt" });
  await run(process.execPath, ["scripts/seed-evaluation.mjs"], { cwd: appRoot });
  await run(process.execPath, ["scripts/seed-inventory-demo.mjs"], { cwd: appRoot });
  if(clinicalMode) await run(process.execPath,["scripts/seed-clinical-demo.mjs"],{cwd:appRoot});
  if(customersMode)await run(process.execPath,["scripts/seed-customers-demo.mjs"],{cwd:appRoot});
  if(shippingMode) await run(process.execPath,["scripts/seed-shipping-demo.mjs"],{cwd:appRoot});
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
    if(releaseMode)await run(process.execPath,["scripts/prepare-customer-demo.mjs"],{cwd:appRoot,record:"customer-demo.txt"});
    if(shippingMode)await run(process.execPath,["scripts/prepare-shipping-demo.mjs"],{cwd:appRoot,record:"shipping-demo.txt"});
    if(customersMode && !shippingMode)await run(process.execPath,["scripts/prepare-customer-demo.mjs"],{cwd:appRoot,record:"customer-demo.txt"});
    console.log(`Demostración local con datos sintéticos: ${env.EVALUATION_HTTP_URL}`);
    console.log("Cierre con Ctrl+C para detener y eliminar el clúster de demostración.");
    await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); process.stdin.resume(); process.stdin.on("data",(data)=>{if(data.toString().trim()==="stop")resolve();}); });
    process.stdin.pause();
  } else {
  if(customersMode){
    await run(process.execPath,["--test","--test-concurrency=1","tests/customers/validation.test.js","tests/customers/flow.test.js"],{cwd:appRoot,record:"customers.txt"});
    await run(process.execPath,["node_modules/playwright/cli.js","test","--config","tests/customers/playwright.config.mjs"],{cwd:appRoot,record:"customers-browser.txt"});
  }
  if(clinicalMode) {
    await run(process.execPath,["--test","--test-concurrency=1","tests/clinical/validation.test.js","tests/clinical/flow.test.js"],{cwd:appRoot,record:"clinical.txt"});
    await run(process.execPath,["node_modules/playwright/cli.js","test","--config","tests/clinical/playwright.config.mjs"],{cwd:appRoot,record:"clinical-browser.txt"});
  }
  if (!clinicalOnly) {
  if (inventoryMode) {
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/unit/rut.test.js", "tests/unit/appointment-validation.test.js", "tests/unit/availability-engine.test.js", "tests/unit/password.test.js", "tests/integration/evaluation.test.js"], { cwd: appRoot, record: "academicas.txt" });
    await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "playwright.evaluation.config.mjs"], { cwd: appRoot, record: "academicas-e2e.txt" });
    await cp(path.join(appRoot, "tmp/evaluation"), path.join(output, "academic-artifacts"), { recursive: true });
    await run(process.execPath, ["--test", "--test-concurrency=1", "tests/inventory/flow.test.js"], { cwd: appRoot, record: "inventory.txt" });
    if(posMode) await run(process.execPath,["--test","--test-concurrency=1","tests/pos/validation.test.js","tests/pos/flow.test.js"],{cwd:appRoot,record:"pos.txt"});
  }
  await run(process.execPath, ["--test", "--test-concurrency=1", "tests/prescriptions/validation.test.js", "tests/prescriptions/flow.test.js"], { cwd: appRoot, record: "tests.txt" });
  await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "tests/prescriptions/playwright.config.mjs"], { cwd: appRoot, record: "browser.txt" });
  if (inventoryMode) await run(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "tests/inventory/playwright.config.mjs"], { cwd: appRoot, record: "inventory-browser.txt" });
  if (posMode) await run(process.execPath,["node_modules/playwright/cli.js","test","--config","tests/pos/playwright.config.mjs"],{cwd:appRoot,record:"pos-browser.txt"});
  }
  }
  if(shippingMode && !process.argv.includes("--demo")){
    await run(process.execPath,["--test","--test-concurrency=1","tests/shipping/policy.test.js","tests/shipping/flow.test.js"],{cwd:appRoot,record:"shipping.txt"});
    await run(process.execPath,["node_modules/playwright/cli.js","test","--config","tests/shipping/playwright.config.mjs"],{cwd:appRoot,record:"shipping-browser.txt"});
  }
  if(releaseMode && !process.argv.includes("--demo")) {
    await run(process.execPath,["--test","--test-concurrency=1","tests/release/security.test.js","tests/release/flow.test.js"],{cwd:appRoot,record:"release.txt"});
    await run(process.execPath,["node_modules/playwright/cli.js","test","--config","tests/release/playwright.config.mjs"],{cwd:appRoot,record:"release-browser.txt"});
    await run(process.execPath,["--test","--test-concurrency=1","tests/integration/store-catalog.test.js","tests/integration/report-dates.test.js","tests/reconciliation/flow.test.js"],{cwd:appRoot,record:"reconciliation.txt"});
    await run(process.execPath,["node_modules/playwright/cli.js","test","--config","tests/reconciliation/playwright.config.mjs"],{cwd:appRoot,record:"reconciliation-browser.txt"});
    await run(process.execPath,["scripts/db-audit.mjs"],{cwd:appRoot,record:"db-audit.txt"});
    await run(process.execPath,["scripts/db-reconciliation.mjs"],{cwd:appRoot,record:"db-reconciliation.txt"});
    // The validation page remains unavailable in the production build. Test
    // synthetic camera input on a separate loopback development server.
    const vtoPort=3159;await freePort(vtoPort);
    vtoServer=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--webpack","--hostname","127.0.0.1","--port",String(vtoPort)],{cwd:appRoot,env:{...env,NODE_ENV:"development",OPTICASTYLO_BUILD_DIR:".next-vto-validation"},windowsHide:true,stdio:["ignore","pipe","pipe"]});
    for(const stream of [vtoServer.stdout,vtoServer.stderr])stream.on("data",chunk=>{vtoOutput+=chunk;});
    let vtoReady=false;
    for(let attempt=0;attempt<100;attempt++){
      if(vtoServer.exitCode!==null)throw new Error("El servidor aislado del probador no inició.");
      try{vtoReady=(await fetch(`http://127.0.0.1:${vtoPort}/api/health`,{signal:AbortSignal.timeout(2000)})).ok;}catch{/* Esperar compilación de desarrollo. */}
      if(vtoReady)break;await new Promise(resolve=>setTimeout(resolve,300));
    }
    if(!vtoReady)throw new Error("El probador aislado no estuvo disponible.");
    env.VTO_BASE_URL=`http://127.0.0.1:${vtoPort}`;
    try{await run(process.execPath,["node_modules/playwright/cli.js","test","--config","playwright.vto.config.mjs"],{cwd:appRoot,record:"vto-browser.txt"});}
    finally{await writeFile(path.join(output,"vto-server.txt"),vtoOutput);}
  }
  }
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if(vtoServer?.exitCode===null){const exited=new Promise(resolve=>vtoServer.once("exit",resolve));vtoServer.kill();await exited;}
  if(vtoServer && existsSync(output))await writeFile(path.join(output,"vto-server.txt"),vtoOutput);
  if (inventoryMode && existsSync(path.join(appRoot, "tmp/evaluation"))) await cp(path.join(appRoot, "tmp/evaluation"), path.join(output, "academic-artifacts"), { recursive: true });
  if (server?.exitCode === null) { const exited = new Promise((resolve) => server.once("exit", resolve)); server.kill(); await exited; }
  if (existsSync(output)) await writeFile(path.join(output, "server.txt"), serverOutput);
  if (pgStarted) {
    const database = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const assets = process.argv.includes("--migrations-only") ? [] : await database.external_prescriptions.findMany({ where: { cloudinary_asset_id: { not: null } } });
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
