import { PrismaClient } from "@prisma/client";

const prismaGlobal = globalThis;

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = prismaGlobal.__opticaStyloPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.__opticaStyloPrisma = prisma;
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
  delete prismaGlobal.__opticaStyloPrisma;
}
