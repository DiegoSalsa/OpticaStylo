import { loadProjectEnvironment } from "./load-environment.mjs";
import { auditDatabase, loadReference } from "./lib/schema-audit.mjs";
loadProjectEnvironment();
const { prisma } = await import("../src/db/prisma.js");
try {
  const audit=await auditDatabase(prisma,await loadReference());
  console.log(JSON.stringify(audit,null,2));
  if(audit.status==="BLOCKED") process.exitCode=1;
} finally {await prisma.$disconnect();}
