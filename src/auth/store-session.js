import { findActiveCustomerSession } from "../repositories/store-account-repository.js";
// Utilidades de autenticación y control de acceso para proteger las operaciones de la aplicación.
import { AppError } from "../utils/app-error.js";
import { hashSessionToken } from "./session-token.js";
import { shouldUseSecureCookies } from "./cookie-security.js";

export const STORE_SESSION_COOKIE_NAME = "opticastylo_customer_session";
export const STORE_CART_COOKIE_NAME = "opticastylo_store_cart";

// Centralizar la lógica de cookie value para mantener consistente el comportamiento de la aplicación
function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

// Centralizar la lógica de cookie para mantener consistente el comportamiento de la aplicación
function cookie(name, value, maxAgeSeconds, environment = process.env) {
  const attributes = [
    `${name}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (shouldUseSecureCookies(environment)) attributes.push("Secure");
  return attributes.join("; ");
}

// Crear o registrar create tienda sesión cookie aplicando las reglas de negocio y persistencia correspondientes
export function createStoreSessionCookie(token, maxAgeSeconds, environment = process.env) {
  return cookie(STORE_SESSION_COOKIE_NAME, token, maxAgeSeconds, environment);
}

// Crear o registrar create tienda carrito cookie aplicando las reglas de negocio y persistencia correspondientes
export function createStoreCartCookie(token, maxAgeSeconds, environment = process.env) {
  return cookie(STORE_CART_COOKIE_NAME, token, maxAgeSeconds, environment);
}

// Centralizar la lógica de expire tienda sesión cookie para mantener consistente el comportamiento de la aplicación
export function expireStoreSessionCookie(environment = process.env) {
  return cookie(STORE_SESSION_COOKIE_NAME, "", 0, environment);
}

// Consultar get tienda carrito token y devolver los datos en el formato esperado por la capa llamadora
export function getStoreCartToken(request) {
  return cookieValue(request.headers.get("cookie"), STORE_CART_COOKIE_NAME);
}

// Centralizar la lógica de authenticate cliente solicitud para mantener consistente el comportamiento de la aplicación
export async function authenticateCustomerRequest(
  request,
  { optional = false, findSession = findActiveCustomerSession } = {},
) {
  const token = cookieValue(request.headers.get("cookie"), STORE_SESSION_COOKIE_NAME);
  const account = token ? await findSession(hashSessionToken(token)) : null;
  if (!account && !optional) {
    throw new AppError({
      code: "CUSTOMER_AUTHENTICATION_REQUIRED",
      message: "Debe iniciar sesión como cliente para realizar esta operación.",
      status: 401,
    });
  }
  return account;
}
