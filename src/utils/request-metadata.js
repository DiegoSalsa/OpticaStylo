export function getRequestMetadata(request) {
  return {
    // La IP se mantendrá vacía hasta definir un proxy confiable en despliegue.
    ipAddress: null,
    userAgent: request.headers.get("user-agent"),
  };
}
