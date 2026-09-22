import { PrismaClient } from "@prisma/client";
// Código de la aplicación para prisma.

const prismaGlobal = globalThis;

// Crear o registrar create prisma client aplicando las reglas de negocio y persistencia correspondientes
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = prismaGlobal.__opticaStyloPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.__opticaStyloPrisma = prisma;
}

// Centralizar la lógica de disconnect prisma para mantener consistente el comportamiento de la aplicación
export async function disconnectPrisma() {
  await prisma.$disconnect();
  delete prismaGlobal.__opticaStyloPrisma;
}
