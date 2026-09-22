// Validar y normalizar normalize forwarded address antes de continuar con la operación
function normalizeForwardedAddress(value) {
  if (typeof value !== "string") return null;
  const address = value.split(",")[0]?.trim();
  if (!address || address.length > 64) return null;
  return address;
}

// Consultar get trusted forwarded address y devolver los datos en el formato esperado por la capa llamadora
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

// Consultar get solicitud metadatos y devolver los datos en el formato esperado por la capa llamadora
export function getRequestMetadata(request, environment = process.env) {
  return {
    ipAddress: getTrustedForwardedAddress(request, environment),
    userAgent: request.headers.get("user-agent"),
  };
}
// Utilidades compartidas para request-metadata.
// Validar y normalizar normalize forwarded address antes de continuar con la operación
