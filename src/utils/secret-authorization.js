import { createHash, timingSafeEqual } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidBearerSecret(request, expectedSecret) {
  if (typeof expectedSecret !== "string" || expectedSecret.length < 16) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const candidate = authorization.slice("Bearer ".length);
  return timingSafeEqual(digest(candidate), digest(expectedSecret));
}

