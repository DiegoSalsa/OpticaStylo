import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con discount-authorization-repository.

const MAXIMUM_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

// Centralizar la lógica de begin descuento authorization attempt para mantener consistente el comportamiento de la aplicación
export async function beginDiscountAuthorizationAttempt({ attemptedBy, authorizerEmail, maximumAttempts = MAXIMUM_ATTEMPTS, windowMinutes = WINDOW_MINUTES }) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const total = await client.discount_authorization_attempts.count({
      where: {
        attempted_at: { gte: since }, status: { in: ["PENDING", "FAILED"] },
        OR: [{ attempted_by: attemptedBy }, { authorizer_email: authorizerEmail }],
      },
    });
    const allowed = total < maximumAttempts;
    const row = await client.discount_authorization_attempts.create({ data: {
      attempted_by: attemptedBy, authorizer_email: authorizerEmail,
      completed_at: allowed ? null : new Date(), status: allowed ? "PENDING" : "RATE_LIMITED",
    } });
    return { allowed, attemptId: row.id };
  // Usar aislamiento serializable para reducir conflictos entre operaciones concurrentes
  }, { isolationLevel: "Serializable" });
}

// Centralizar la lógica de complete descuento authorization attempt para mantener consistente el comportamiento de la aplicación
export async function completeDiscountAuthorizationAttempt(attemptId, { authorizerUserId = null, succeeded }) {
  const result = await prisma.discount_authorization_attempts.updateMany({
    data: { authorizer_user_id: authorizerUserId, completed_at: new Date(), status: succeeded ? "SUCCEEDED" : "FAILED" },
    where: { id: attemptId, status: "PENDING" },
  });
  if (result.count !== 1) throw new Error("El intento de autorización de descuento ya no está vigente.");
}
