import { executeQuery } from "../db/query.js";

export async function reservePublicRequestQuota({
  bucket,
  subjectHash,
  windowSeconds,
}) {
  const result = await executeQuery(
    `
      INSERT INTO public_request_rate_limits (
        bucket, subject_hash, window_started_at, expires_at, request_count
      ) VALUES (
        $1, $2, CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + make_interval(secs => $3), 1
      )
      ON CONFLICT (bucket, subject_hash) DO UPDATE
      SET
        request_count = CASE
          WHEN public_request_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN 1
          ELSE public_request_rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN public_request_rate_limits.expires_at <= CURRENT_TIMESTAMP
            THEN CURRENT_TIMESTAMP
          ELSE public_request_rate_limits.window_started_at
        END,
        expires_at = CASE
          WHEN public_request_rate_limits.expires_at <= CURRENT_TIMESTAMP
            THEN CURRENT_TIMESTAMP + make_interval(secs => $3)
          ELSE public_request_rate_limits.expires_at
        END
      RETURNING request_count, expires_at
    `,
    [bucket, subjectHash, windowSeconds],
  );
  return {
    attempts: Number(result.rows[0].request_count),
    expiresAt: result.rows[0].expires_at,
  };
}
