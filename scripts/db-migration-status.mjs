import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { getMigrationStatus } = await import(
  "../src/db/migration-runner.js"
);
const { closeDatabasePool } = await import("../src/db/pool.js");

try {
  const migrations = await getMigrationStatus();

  if (migrations.length === 0) {
    console.log("Todavía no existen migraciones de aplicación.");
  } else {
    for (const migration of migrations) {
      console.log(`${migration.fileName}: ${migration.status}`);
    }
  }
} finally {
  await closeDatabasePool();
}
