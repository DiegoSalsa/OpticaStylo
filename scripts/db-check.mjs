import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { checkDatabaseConnection } = await import(
  "../src/db/check-connection.js"
);
const { closeDatabasePool } = await import("../src/db/pool.js");

try {
  const database = await checkDatabaseConnection();
  console.log("Conexión con PostgreSQL verificada.");
  console.log(`Base de datos: ${database.database_name}`);
  console.log(`Usuario: ${database.database_user}`);
  console.log(`Versión: ${database.server_version}`);
} finally {
  await closeDatabasePool();
}
