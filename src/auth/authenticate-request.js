import { findActiveSessionByTokenHash } from "../repositories/session-repository.js";
// Utilidades de autenticación y control de acceso para proteger las operaciones de la aplicación.
import { AppError } from "../utils/app-error.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "./session-token.js";

// Consultar get cookie value y devolver los datos en el formato esperado por la capa llamadora
function getCookieValue(cookieHeader, cookieName) {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();

    if (name === cookieName) {
      return cookie.slice(separatorIndex + 1).trim() || null;
    }
  }

  return null;
}

// Construir y lanzar el error de dominio asociado a throw authentication required
function throwAuthenticationRequired() {
  throw new AppError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Debe iniciar sesión para realizar esta operación.",
    status: 401,
  });
}

// Centralizar la lógica de authenticate solicitud para mantener consistente el comportamiento de la aplicación
export async function authenticateRequest(request, dependencies = {}) {
  const findSession =
    dependencies.findActiveSessionByTokenHash ?? findActiveSessionByTokenHash;
  const token = getCookieValue(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME,
  );

  if (!token) {
    throwAuthenticationRequired();
  }

  const session = await findSession(hashSessionToken(token));

  if (!session) {
    throwAuthenticationRequired();
  }

  return session;
}
