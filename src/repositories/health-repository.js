import { prisma } from "../db/prisma.js";

export async function checkDatabaseConnection() {
  await prisma.roles.count();
}
