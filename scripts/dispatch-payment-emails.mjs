import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { processTransactionalEmailBatch } = await import(
  "../src/services/transactional-email-service.js"
);
const { disconnectPrisma } = await import("../src/db/prisma.js");

try {
  const summary = await processTransactionalEmailBatch({ triggerSource: "script" });
  console.log(JSON.stringify({
    claimed: summary.claimed,
    deadLetter: summary.deadLetter,
    failed: summary.failed,
    mode: summary.mode,
    recovered: summary.recovered,
    sent: summary.sent,
    simulated: summary.simulated,
    status: summary.status,
  }));
  if (["FAILED", "PARTIAL"].includes(summary.status)) process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
