import { prisma } from "../db/prisma.js";

export async function reservePublicRequestQuota({ bucket, subjectHash, windowSeconds }) {
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
  }, { isolationLevel: "Serializable" });
}
