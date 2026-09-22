import { SESSION_COOKIE_NAME } from "./session-token.js";
// Utilidades de autenticación y control de acceso para proteger las operaciones de la aplicación.
import { shouldUseSecureCookies } from "./cookie-security.js";

// Crear o registrar create sesión cookie aplicando las reglas de negocio y persistencia correspondientes
export function createSessionCookie(token, maxAgeSeconds, environment = process.env) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (shouldUseSecureCookies(environment)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

// Crear o registrar create expired sesión cookie aplicando las reglas de negocio y persistencia correspondientes
export function createExpiredSessionCookie(environment = process.env) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (shouldUseSecureCookies(environment)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
