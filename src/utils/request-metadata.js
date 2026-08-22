function normalizeForwardedAddress(value) {
  if (typeof value !== "string") return null;
  const address = value.split(",")[0]?.trim();
  if (!address || address.length > 64) return null;
  return address;
}

function getTrustedForwardedAddress(request, environment) {
  if (environment.VERCEL === "1") {
    return normalizeForwardedAddress(request.headers.get("x-vercel-forwarded-for"))
      ?? normalizeForwardedAddress(request.headers.get("x-forwarded-for"));
  }
  if (environment.TRUST_PROXY === "true") {
    return normalizeForwardedAddress(request.headers.get("x-forwarded-for"));
  }
  return null;
}

export function getRequestMetadata(request, environment = process.env) {
  return {
    ipAddress: getTrustedForwardedAddress(request, environment),
    userAgent: request.headers.get("user-agent"),
  };
}
