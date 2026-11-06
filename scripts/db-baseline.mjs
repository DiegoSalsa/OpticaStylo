import { spawnSync } from "node:child_process";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { auditDatabase, baselineName, loadReference } from "./lib/schema-audit.mjs";
loadProjectEnvironment();
const { prisma } = await import("../src/db/prisma.js");
try {
  const audit = await auditDatabase(prisma,await loadReference());
  console.log(JSON.stringify(audit,null,2));
  if (!process.argv.includes("--apply")) {
    console.log("Solo auditoría. No se modificó el historial de migraciones.");
    if (audit.status === "BLOCKED") process.exitCode=1;
  } else {
    const index=process.argv.indexOf("--expected-fingerprint");
    if (process.env.MIGRATION_BASELINE_AUTHORIZED !== "true" || audit.status !== "LEGACY_BASELINE_VERIFIED" || index<0 || process.argv[index+1]!==audit.fingerprint) throw new Error("Baseline bloqueado: requiere autorización operativa, estructura exacta, historial verificado y huella esperada.");
    const result=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","resolve","--applied",baselineName],{env:process.env,stdio:"inherit",windowsHide:true});
    process.exitCode=result.status??1;
  }
} finally {await prisma.$disconnect();}
