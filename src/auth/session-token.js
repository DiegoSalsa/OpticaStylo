import { createHash, randomBytes } from "node:crypto";
// Utilidades de autenticación y control de acceso para proteger las operaciones de la aplicación.

export const SESSION_COOKIE_NAME = "opticastylo_session";

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("El token de sesión debe ser una cadena no vacía.");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}
