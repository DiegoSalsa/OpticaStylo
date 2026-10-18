import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { fixtureRut } from "./management-data.js";

// Identidades sintéticas públicas: solo existen en el clúster efímero de pruebas.
export const evaluation = Object.freeze({
  adminEmail: "evaluacion-admin@example.invalid",
  restrictedEmail: "evaluacion-sin-permisos@example.invalid",
  password: "Solo-evaluacion-local-2026!",
  adminId: "20000000-0000-4000-8000-000000000001",
  restrictedId: "20000000-0000-4000-8000-000000000002",
  professionalId: "20000000-0000-4000-8000-000000000003",
  patientId: "20000000-0000-4000-8000-000000000004",
  appointmentId: "20000000-0000-4000-8000-000000000005",
  customerId: "20000000-0000-4000-8000-000000000006",
  saleId: "20000000-0000-4000-8000-000000000007",
  patientRut: fixtureRut(8100),
  customerRut: fixtureRut(8200),
  startAt: "2030-10-16T14:00:00.000Z",
  endAt: "2030-10-16T15:00:00.000Z",
  appointmentQuery: "from=2030-10-16T00:00:00Z&to=2030-10-17T00:00:00Z",
});

export function requireEvaluationDatabase(databaseUrl, schema) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== String(process.env.EVALUATION_PG_PORT ?? "55439")
    || url.pathname !== "/opticastylo_evaluation" || url.username !== "stylo_test"
    || !/^stylo_e2e_[0-9a-f]{16}$/.test(schema ?? "")
    || url.searchParams.get("schema") !== schema) {
    throw new Error("Se requiere la base local efímera de run-evaluation.mjs.");
  }
}

export async function connectEvaluationDatabase() {
  const runtime = JSON.parse(await readFile(new URL("../../tmp/evaluation/runtime.json", import.meta.url), "utf8")
    .catch((error) => {
      if (error.code === "ENOENT") throw new Error("Inicia el entorno con npm run test:evaluation:e2e, test:evaluation:ui o test:evaluation:server.");
      throw error;
    }));
  requireEvaluationDatabase(runtime.databaseUrl, runtime.schema);
  return new PrismaClient({ datasourceUrl: runtime.databaseUrl });
}
