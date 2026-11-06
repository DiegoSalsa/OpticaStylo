import { PrismaClient } from "@prisma/client";

const prismaGlobal = globalThis;

function createPrismaClient() {
  const client=new PrismaClient({log:[{emit:"event",level:"error"}]});
  // Los errores de Prisma pueden incluir argumentos de consultas con datos de salud.
  client.$on("error",()=>console.error("Falló una operación de base de datos."));
  return client;
}

export const prisma = prismaGlobal.__opticaStyloPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.__opticaStyloPrisma = prisma;
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
  delete prismaGlobal.__opticaStyloPrisma;
}
