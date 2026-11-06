import { prisma } from "../db/prisma.js";

export async function reservePublicRequestQuota({ bucket, subjectHash, windowSeconds }) {
  // One statement locks only the conflicting quota row. Concurrent identities
  // no longer contend on a serializable read/upsert predicate. Window resets
  // and increments cannot lose updates across serverless instances.
  const [row] = await prisma.$queryRaw`
    INSERT INTO public_request_rate_limits AS quota
      (bucket,subject_hash,request_count,window_started_at,expires_at)
    VALUES (${bucket},${subjectHash},1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+${windowSeconds}::int*interval '1 second')
    ON CONFLICT (bucket,subject_hash) DO UPDATE SET
      request_count=CASE WHEN quota.expires_at<=CURRENT_TIMESTAMP THEN 1 ELSE quota.request_count+1 END,
      window_started_at=CASE WHEN quota.expires_at<=CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE quota.window_started_at END,
      expires_at=CASE WHEN quota.expires_at<=CURRENT_TIMESTAMP THEN EXCLUDED.expires_at ELSE quota.expires_at END
    RETURNING request_count,expires_at`;
  return { attempts: row.request_count, expiresAt: row.expires_at };
}
