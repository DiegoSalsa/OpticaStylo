import { prisma } from "./prisma.js";

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
