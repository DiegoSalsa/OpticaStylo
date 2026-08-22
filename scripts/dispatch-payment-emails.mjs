import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { deliverDuePaymentConfirmations } = await import(
  "../src/services/transactional-email-service.js"
);
const { closeDatabasePool } = await import("../src/db/pool.js");

try {
  const results = await deliverDuePaymentConfirmations();
  const sent = results.filter((entry) => entry.result.status === "SENT").length;
  const failed = results.filter((entry) => entry.result.status === "FAILED").length;
  console.log(`Correos procesados: ${results.length}; enviados: ${sent}; fallidos: ${failed}.`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
