import { Pool } from "pg";

import { getDatabaseConfig } from "./config.js";

const databaseGlobal = globalThis;

function createDatabasePool() {
  const pool = new Pool(getDatabaseConfig());

  pool.on("error", (error) => {
    console.error("Error inesperado en una conexión inactiva de PostgreSQL.", error);
  });

  return pool;
}

export function getDatabasePool() {
  if (!databaseGlobal.__opticaStyloDatabasePool) {
    databaseGlobal.__opticaStyloDatabasePool = createDatabasePool();
  }

  return databaseGlobal.__opticaStyloDatabasePool;
}

export async function closeDatabasePool() {
  if (!databaseGlobal.__opticaStyloDatabasePool) {
    return;
  }

  await databaseGlobal.__opticaStyloDatabasePool.end();
  delete databaseGlobal.__opticaStyloDatabasePool;
}
