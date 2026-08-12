import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDatabasePool } from "./pool.js";

const MIGRATION_FILE_PATTERN = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_ID = 743_205_117;
const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("./migrations/", import.meta.url),
);

export function calculateMigrationChecksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function parseMigrationFileName(fileName) {
  const match = MIGRATION_FILE_PATTERN.exec(fileName);

  if (!match) {
    throw new Error(
      `La migración ${fileName} debe seguir el formato 001_descripcion.sql.`,
    );
  }

  return {
    name: match[2],
    version: Number(match[1]),
  };
}

export async function loadMigrations(
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const migrations = await Promise.all(
    sqlFiles.map(async (fileName) => {
      const { name, version } = parseMigrationFileName(fileName);
      const sql = await readFile(path.join(migrationsDirectory, fileName), "utf8");

      if (!sql.trim()) {
        throw new Error(`La migración ${fileName} está vacía.`);
      }

      return {
        checksum: calculateMigrationChecksum(sql),
        fileName,
        name,
        sql,
        version,
      };
    }),
  );

  const versions = new Set();

  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`La versión ${migration.version} está repetida.`);
    }

    versions.add(migration.version);
  }

  return migrations.sort((first, second) => first.version - second.version);
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL,
      checksum CHAR(64) NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(`
    SELECT version, name, checksum, executed_at
    FROM schema_migrations
    ORDER BY version
  `);

  return result.rows;
}

function validateAppliedMigrations(migrations, appliedMigrations) {
  const migrationsByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );

  for (const appliedMigration of appliedMigrations) {
    const localMigration = migrationsByVersion.get(appliedMigration.version);

    if (!localMigration) {
      throw new Error(
        `La migración aplicada ${appliedMigration.version} no existe en el repositorio.`,
      );
    }

    if (
      localMigration.name !== appliedMigration.name ||
      localMigration.checksum !== appliedMigration.checksum.trim()
    ) {
      throw new Error(
        `La migración aplicada ${appliedMigration.version} fue modificada.`,
      );
    }
  }
}

async function withMigrationLock(operation, pool) {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    return await operation(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }
}

export async function getMigrationStatus(options = {}) {
  const migrations = await loadMigrations(options.migrationsDirectory);
  const pool = options.pool ?? getDatabasePool();

  return withMigrationLock(async (client) => {
    await ensureMigrationsTable(client);
    const appliedMigrations = await getAppliedMigrations(client);
    validateAppliedMigrations(migrations, appliedMigrations);

    const appliedVersions = new Set(
      appliedMigrations.map((migration) => migration.version),
    );

    return migrations.map((migration) => ({
      fileName: migration.fileName,
      status: appliedVersions.has(migration.version) ? "applied" : "pending",
      version: migration.version,
    }));
  }, pool);
}

export async function runPendingMigrations(options = {}) {
  const migrations = await loadMigrations(options.migrationsDirectory);
  const pool = options.pool ?? getDatabasePool();

  return withMigrationLock(async (client) => {
    await ensureMigrationsTable(client);
    const appliedMigrations = await getAppliedMigrations(client);
    validateAppliedMigrations(migrations, appliedMigrations);

    const appliedVersions = new Set(
      appliedMigrations.map((migration) => migration.version),
    );
    const pendingMigrations = migrations.filter(
      (migration) => !appliedVersions.has(migration.version),
    );
    const executedMigrations = [];

    for (const migration of pendingMigrations) {
      await client.query("BEGIN");

      try {
        await client.query(migration.sql);
        await client.query(
          `
            INSERT INTO schema_migrations (version, name, checksum)
            VALUES ($1, $2, $3)
          `,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        executedMigrations.push(migration.fileName);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${migration.fileName}.`, {
          cause: error,
        });
      }
    }

    return executedMigrations;
  }, pool);
}
