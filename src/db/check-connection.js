import { prisma } from "./prisma.js";
// Código de la aplicación para check-connection.

// Verificar check base de datos connection para impedir que la operación continúe en un estado inválido
export async function checkDatabaseConnection() {
  const roleCount = await prisma.roles.count();
  const databaseUrl = new URL(process.env.DATABASE_URL);
  return {
    database_name: decodeURIComponent(databaseUrl.pathname.slice(1)),
    database_user: decodeURIComponent(databaseUrl.username),
    orm: "Prisma",
    role_count: roleCount,
  };
}
