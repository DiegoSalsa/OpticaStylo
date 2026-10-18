import { mkdir } from "node:fs/promises";
import { prisma } from "../src/db/prisma.js";
import { requireAcademicIsolation } from "../tests/fixtures/academic-data.js";
import { seedStoreE2e } from "./seed-store-e2e.mjs";
import { seedManagementData } from "../tests/fixtures/management-data.js";

try {
  requireAcademicIsolation();
  await mkdir("tmp/store-e2e",{recursive:true});
  if(process.argv[2]==="management") await seedManagementData();
  else if(process.argv[2]==="store") await seedStoreE2e();
  else throw new Error("Fixture histórico desconocido.");
  console.log("Fixture histórico preparado únicamente en la base local dedicada.");
} finally {await prisma.$disconnect();}
