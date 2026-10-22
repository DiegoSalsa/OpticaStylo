import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { execute, prepareIsolation, readState, sanitizedEnvironment } from "./academic-isolation.mjs";

const [phase, suppliedEvidenceDirectory] = process.argv.slice(2);
if (phase === "prepare") {
  if (!suppliedEvidenceDirectory) throw new Error("Indique un directorio de evidencia.");
  const state = await prepareIsolation(path.resolve(suppliedEvidenceDirectory));
  console.log(`Entorno aislado preparado: ${state.container}. Proveedores externos deshabilitados.`);
} else {
  const state = await readState();
  const environment = await sanitizedEnvironment(state);
  const commands = {
    validate: ["node_modules/prisma/build/index.js", "validate"],
    lint: ["node_modules/eslint/bin/eslint.js", "."],
    general: ["--test"],
    integration: ["--test", "tests/integration/academic-critical-flows.test.js"],
    management: ["--test", "tests/integration/management-pagination.test.js"],
    store: ["--test", "tests/integration/store-guest-checkout.test.js"],
    catalog: ["--test", "tests/integration/store-catalog.test.js"],
    reports: ["--test", "tests/integration/report-dates.test.js"],
    demo: ["scripts/prepare-demo-data.mjs"],
    "seed-store": ["scripts/seed-academic-legacy.mjs", "store"],
    "seed-management": ["scripts/seed-academic-legacy.mjs", "management"],
    "store-e2e": ["node_modules/playwright/cli.js", "test", "--config", "playwright.config.mjs", "store-guest-checkout.spec.js"],
    "management-e2e": ["node_modules/playwright/cli.js", "test", "--config", "playwright.config.mjs", "management-pagination.spec.js", "--project", "desktop"],
    "demo-e2e": ["node_modules/playwright/cli.js", "test", "--config", "playwright.config.mjs", "demo-regression.spec.js", "--project", "desktop"],
    build: ["node_modules/next/dist/bin/next", "build"],
    seed: ["scripts/seed-academic-demo.mjs"],
    "refresh-e2e": ["scripts/seed-academic-demo.mjs", "refresh-e2e"],
    e2e: ["node_modules/playwright/cli.js", "test", "--config", "playwright.academic.config.mjs"],
  };
  if (phase === "general") {
    delete environment.STORE_E2E_SCHEMA;
    delete environment.ACADEMIC_ISOLATION;
  }
  if (commands[phase]) {
    const git = await execute("git", ["rev-parse", "HEAD"]);
    const branch = await execute("git", ["branch", "--show-current"]);
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    const log = path.join(state.evidenceDir, `${phase}-${suffix}.log`);
    const browserReport = path.join(state.evidenceDir, `${phase}-${suffix}-playwright-results.json`);
    let transientSchema=null;
    try {
      // Cada suite PostgreSQL recibe tablas nuevas sin alterar la demostración del servidor.
      if(["integration","store","management","catalog","reports"].includes(phase)) {
        transientSchema=`stylo_e2e_${randomBytes(8).toString("hex")}`;
        await execute("docker",["exec",state.container,"psql","-U","stylo_test","-d",state.database,"-v","ON_ERROR_STOP=1","-c",`CREATE SCHEMA "${transientSchema}";`]);
        const url=new URL(state.databaseUrl);url.searchParams.set("schema",transientSchema);
        environment.DATABASE_URL=url.href;environment.STORE_E2E_SCHEMA=transientSchema;
        await execute(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],environment,`${log}.migrations`);
      }
      const result = await execute(process.execPath, commands[phase], {
        ...environment, NODE_ENV: phase === "build" ? "production" : "test",
        ACADEMIC_EVIDENCE_DIR: state.evidenceDir,
        STORE_E2E_REPORT_PATH: browserReport,
        // La preparación manual mantiene fecha configurable y confirmación explícita.
        ...(phase === "demo" ? { DEMO_DATE: process.env.DEMO_DATE, DEMO_PREPARE_CONFIRM: process.env.DEMO_PREPARE_CONFIRM } : {}),
      }, log);
      const record = { phase, testedAt: new Date().toISOString(), branch: branch.output.trim(), sha: git.output.trim(),
        workingTree: (await execute("git", ["status", "--porcelain"])).output.trim(),
        command: `node ${commands[phase].join(" ")}`, code: result.code, durationMs: result.durationMs, log,
        ...(["e2e","store-e2e","management-e2e","demo-e2e"].includes(phase)?{browserReport}:{}), ...(transientSchema?{transientSchema}:{}), };
      await writeFile(`${log}.json`, JSON.stringify(record, null, 2));
      console.log(JSON.stringify(record));
      console.log(result.output.slice(-6500));
    } catch (error) {
      await writeFile(`${log}.json`, JSON.stringify({ phase, sha: git.output.trim(), branch: branch.output.trim(),
        testedAt: new Date().toISOString(), code: error.result?.code ?? null, durationMs: error.result?.durationMs ?? null,
        command: `node ${commands[phase].join(" ")}`, log }, null, 2));
      console.error(error.result?.output.slice(-10000) ?? error.message);
      process.exitCode = 1;
    } finally {
      if(transientSchema) {
        if(!/^stylo_e2e_[0-9a-f]{16}$/.test(transientSchema)||transientSchema===state.schema) throw new Error("Limpieza de schema no autorizada.");
        await execute("docker",["exec",state.container,"psql","-U","stylo_test","-d",state.database,"-v","ON_ERROR_STOP=1","-c",`DROP SCHEMA "${transientSchema}" CASCADE;`]);
      }
    }
  } else if (phase === "reset") {
    // El guard anterior confirma propiedad, host local y nombre exclusivo de esta ejecución.
    await execute("docker", ["exec", state.container, "psql", "-U", "stylo_test", "-d", state.database, "-v", "ON_ERROR_STOP=1", "-c",
      `DROP SCHEMA IF EXISTS "${state.schema}" CASCADE; CREATE SCHEMA "${state.schema}";`]);
    await execute(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], environment,
      path.join(state.evidenceDir, `migraciones-reinicio-${Date.now()}.log`));
    console.log("Recreado únicamente el esquema sintético del contenedor dedicado.");
  } else if (phase === "serve") {
    const { spawn } = await import("node:child_process");
    const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(state.appPort)], {
      env: { ...environment, NODE_ENV: "production" }, windowsHide: true, stdio: "inherit",
    });
    await writeFile("tmp/academic-validation/server.json", JSON.stringify({ pid: server.pid, appPort: state.appPort, runId: state.runId }));
    server.on("exit", (code) => { process.exitCode = code; });
  } else if (phase === "backup") {
    // Solo la base nueva de este contenedor; la restauración usa otra base nueva.
    const restoredDatabase = `${state.database}_restored`;
    const dump = `/tmp/${state.runId}.dump`;
    await execute("docker", ["exec", state.container, "pg_dump", "-U", "stylo_test", "-d", state.database, "-Fc", "-f", dump]);
    await execute("docker", ["exec", state.container, "createdb", "-U", "stylo_test", restoredDatabase]);
    const restored = await execute("docker", ["exec", state.container, "pg_restore", "-U", "stylo_test", "-d", restoredDatabase,
      "--exit-on-error", dump], process.env, path.join(state.evidenceDir, "restauracion.log"));
    const fingerprint = `SELECT md5(string_agg(payload, '|' ORDER BY payload)) FROM (SELECT 'patient:'||row_to_json(p)::text AS payload FROM "${state.schema}".patients p UNION ALL SELECT 'encounter:'||row_to_json(e)::text FROM "${state.schema}".clinical_encounters e UNION ALL SELECT 'sale:'||row_to_json(s)::text FROM "${state.schema}".sales s UNION ALL SELECT 'rx:'||row_to_json(r)::text FROM "${state.schema}".optical_prescriptions r) snapshots;`;
    const source = await execute("docker", ["exec", state.container, "psql", "-U", "stylo_test", "-d", state.database, "-Atc", fingerprint]);
    const target = await execute("docker", ["exec", state.container, "psql", "-U", "stylo_test", "-d", restoredDatabase, "-Atc", fingerprint]);
    if (!source.output.trim() || source.output.trim() !== target.output.trim()) throw new Error("La huella restaurada no coincide.");
    const dumpPath=path.join(state.evidenceDir,"respaldo-sintetico.dump");
    await execute("docker", ["cp", `${state.container}:${dump}`, dumpPath]);
    const countsQuery=`SELECT json_build_object('patients',(SELECT count(*) FROM "${state.schema}".patients),'encounters',(SELECT count(*) FROM "${state.schema}".clinical_encounters),'sales',(SELECT count(*) FROM "${state.schema}".sales),'prescriptions',(SELECT count(*) FROM "${state.schema}".optical_prescriptions));`;
    const counts=await execute("docker",["exec",state.container,"psql","-U","stylo_test","-d",state.database,"-Atc",countsQuery]);
    const git=await execute("git",["rev-parse","HEAD"]);
    const record = { testedAt: new Date().toISOString(), sourceDatabase: state.database, restoredDatabase,
      sha:git.output.trim(), identicalFingerprint: true, fingerprint: source.output.trim(), durationMs: restored.durationMs,
      sourceCounts:JSON.parse(counts.output.trim()), dumpSha256:createHash("sha256").update(await readFile(dumpPath)).digest("hex"),
      scope: "Restauración local con datos sintéticos; no demuestra respaldo o recuperación de producción." };
    await writeFile(path.join(state.evidenceDir, "restauracion.json"), JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record));
  } else if (phase === "cleanup") {
    await execute("docker", ["rm", "--force", state.container]);
    console.log(`Eliminado únicamente el contenedor temporal ${state.container}.`);
  } else throw new Error("Fase desconocida.");
}
