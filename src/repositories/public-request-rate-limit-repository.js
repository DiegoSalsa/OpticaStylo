import { prisma } from "../db/prisma.js";
// Repositorio que encapsula las consultas y escrituras de base de datos relacionadas con public-request-rate-limit-repository.

// Centralizar la lógica de reserve público solicitud quota para mantener consistente el comportamiento de la aplicación
export async function reservePublicRequestQuota({ bucket, subjectHash, windowSeconds }) {
  // Ejecutar las operaciones relacionadas en una transacción para evitar estados parciales
  return prisma.$transaction(async (client) => {
    const now = new Date();
    const current = await client.public_request_rate_limits.findUnique({
      where: { bucket_subject_hash: { bucket, subject_hash: subjectHash } },
    });
    const expired = !current || current.expires_at <= now;
    const expiresAt = expired
      ? new Date(now.getTime() + windowSeconds * 1000)
      : current.expires_at;
    const row = await client.public_request_rate_limits.upsert({
      create: {
        bucket, expires_at: expiresAt, request_count: 1,
        subject_hash: subjectHash, window_started_at: now,
      },
      update: expired
        ? { expires_at: expiresAt, request_count: 1, window_started_at: now }
        : { request_count: { increment: 1 } },
      where: { bucket_subject_hash: { bucket, subject_hash: subjectHash } },
    });
    return { attempts: row.request_count, expiresAt: row.expires_at };
  // Usar aislamiento serializable para reducir conflictos entre operaciones concurrentes
  }, { isolationLevel: "Serializable" });
}
