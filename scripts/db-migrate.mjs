import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { runPendingMigrations } = await import(
  "../src/db/migration-runner.js"
);
const { closeDatabasePool } = await import("../src/db/pool.js");

try {
  const executedMigrations = await runPendingMigrations();

  if (executedMigrations.length === 0) {
    console.log("No existen migraciones pendientes.");
  } else {
    for (const migration of executedMigrations) {
      console.log(`Migración aplicada: ${migration}`);
    }
  }
} finally {
  await closeDatabasePool();
}
