import { spawnSync } from "node:child_process";

import { loadProjectEnvironment } from "./load-environment.mjs";

const BASELINE = "20260908000000_baseline";
const LEGACY_MIGRATION_COUNT = 32;

loadProjectEnvironment();

const { prisma, disconnectPrisma } = await import("../src/db/prisma.js");

try {
  const migrations = await prisma.schema_migrations.findMany({
    orderBy: { version: "asc" },
    select: { version: true },
  });
  const complete = migrations.length === LEGACY_MIGRATION_COUNT
    && migrations.every((migration, index) => migration.version === index + 1);
  if (!complete) {
    throw new Error(
      `No es seguro establecer el baseline: se esperaban las migraciones históricas 1-${LEGACY_MIGRATION_COUNT}.`,
    );
  }
} finally {
  await disconnectPrisma();
}

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "resolve", "--applied", BASELINE],
  { env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
