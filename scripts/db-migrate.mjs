import { spawnSync } from "node:child_process";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { auditDatabase, loadReference } from "./lib/schema-audit.mjs";
loadProjectEnvironment();
const { prisma }=await import("../src/db/prisma.js");
try {
  const audit=await auditDatabase(prisma,await loadReference());
  if (!["EMPTY","PRISMA_MANAGED"].includes(audit.status)) throw new Error("Migración bloqueada: ejecute db:audit y concilie la estructura e historiales antes de continuar.");
  const result=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env:process.env,stdio:"inherit",windowsHide:true});
  process.exitCode=result.status??1;
} finally {await prisma.$disconnect();}
