import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const { checkDatabaseConnection } = await import("../src/db/check-connection.js");
const { disconnectPrisma } = await import("../src/db/prisma.js");

try {
  const database = await checkDatabaseConnection();
  console.log("Conexión con PostgreSQL verificada mediante Prisma ORM.");
  console.log(`Base de datos: ${database.database_name}`);
  console.log(`Usuario: ${database.database_user}`);
  console.log(`Roles configurados: ${database.role_count}`);
} finally {
  await disconnectPrisma();
}
