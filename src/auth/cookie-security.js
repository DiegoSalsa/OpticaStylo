export function shouldUseSecureCookies(environment = process.env) {
  if (environment.NODE_ENV !== "production") {
    return false;
  }

  const permiteHttpUniversidad = environment.DEPLOYMENT_ENVIRONMENT === "university"
    && environment.UNIVERSITY_INSECURE_HTTP_ALLOWED === "true";

  return !permiteHttpUniversidad;
}
// Utilidades de autenticación y control de acceso para proteger las operaciones de la aplicación.
