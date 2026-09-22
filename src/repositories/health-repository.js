import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con health-repository.

// Verificar check base de datos connection para impedir que la operación continúe en un estado inválido
export async function checkDatabaseConnection() {
  await prisma.roles.count();
}
