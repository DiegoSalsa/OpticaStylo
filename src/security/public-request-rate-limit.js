import { createHash } from "node:crypto";

import { reservePublicRequestQuota } from "../repositories/public-request-rate-limit-repository.js";
import { AppError } from "../utils/app-error.js";
import { getRequestMetadata } from "../utils/request-metadata.js";

export const PUBLIC_REQUEST_LIMIT_OPERATIONS = Object.freeze({
  INTERNAL_LOGIN: "internal_login",
  INTERNAL_PRESCRIPTION_EXTRACTION: "internal_prescription_extraction",
  PUBLIC_BOOKING: "public_booking",
  PRESCRIPTION_EXTRACTION: "prescription_extraction",
  PRESCRIPTION_UPLOAD: "prescription_upload",
  STORE_CART_CREATION: "store_cart_creation",
  STORE_LOGIN: "store_login",
  STORE_REGISTRATION: "store_registration",
});

const LIMITS = Object.freeze({
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_LOGIN]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 4, windowSeconds: 15 * 60 }),
    network: Object.freeze({ maximumAttempts: 8, windowSeconds: 15 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.INTERNAL_PRESCRIPTION_EXTRACTION]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 8, windowSeconds: 60 * 60 }),
    network: Object.freeze({ maximumAttempts: 25, windowSeconds: 60 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.PUBLIC_BOOKING]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 2, windowSeconds: 15 * 60 }),
    network: Object.freeze({ maximumAttempts: 6, windowSeconds: 15 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_EXTRACTION]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 3, windowSeconds: 60 * 60 }),
    network: Object.freeze({ maximumAttempts: 10, windowSeconds: 60 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.PRESCRIPTION_UPLOAD]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 3, windowSeconds: 60 * 60 }),
    network: Object.freeze({ maximumAttempts: 10, windowSeconds: 60 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_CART_CREATION]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 12, windowSeconds: 15 * 60 }),
    network: Object.freeze({ maximumAttempts: 12, windowSeconds: 15 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_LOGIN]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 4, windowSeconds: 15 * 60 }),
    network: Object.freeze({ maximumAttempts: 8, windowSeconds: 15 * 60 }),
  }),
  [PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_REGISTRATION]: Object.freeze({
    identifier: Object.freeze({ maximumAttempts: 2, windowSeconds: 15 * 60 }),
    network: Object.freeze({ maximumAttempts: 4, windowSeconds: 15 * 60 }),
  }),
});

function hashSubject(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeIdentifier(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 254 ? normalized : null;
}

function retryAfterSeconds(expiresAt, now) {
  const expiresAtTime = new Date(expiresAt).getTime();
  return Math.max(1, Math.ceil((expiresAtTime - now.getTime()) / 1000));
}

function rateLimitError(expiresAt, now) {
  return new AppError({
    code: "PUBLIC_REQUEST_RATE_LIMITED",
    headers: { "Retry-After": String(retryAfterSeconds(expiresAt, now)) },
    message: "Demasiadas solicitudes. Inténtelo nuevamente en unos minutos.",
    status: 429,
  });
}

async function enforceQuota({ bucket, maximumAttempts, subject, windowSeconds }, dependencies) {
  const result = await (dependencies.reserveQuota ?? reservePublicRequestQuota)({
    bucket,
    subjectHash: hashSubject(subject),
    windowSeconds,
  });
  if (result.attempts > maximumAttempts) {
    throw rateLimitError(result.expiresAt, dependencies.now?.() ?? new Date());
  }
}

export async function enforcePublicRequestRateLimit(
  request,
  operation,
  identifier,
  dependencies = {},
) {
  const limits = LIMITS[operation];
  if (!limits) throw new TypeError("La operación pública no tiene una cuota definida.");

  const metadata = (dependencies.getMetadata ?? getRequestMetadata)(request);
  const networkAddress = normalizeIdentifier(metadata.ipAddress);
  if (networkAddress) {
    await enforceQuota({
      ...limits.network,
      bucket: `${operation}:network`,
      subject: networkAddress,
    }, dependencies);
  }

  const normalizedIdentifier = normalizeIdentifier(identifier);
  if (normalizedIdentifier) {
    await enforceQuota({
      ...limits.identifier,
      bucket: `${operation}:identifier`,
      subject: normalizedIdentifier,
    }, dependencies);
  }
}
