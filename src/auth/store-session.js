import { findActiveCustomerSession } from "../repositories/store-account-repository.js";
// Utilidades de autenticación y control de acceso para proteger las operaciones de la aplicación.
import { AppError } from "../utils/app-error.js";
import { hashSessionToken } from "./session-token.js";
import { shouldUseSecureCookies } from "./cookie-security.js";

export const STORE_SESSION_COOKIE_NAME = "opticastylo_customer_session";
export const STORE_CART_COOKIE_NAME = "opticastylo_store_cart";
const STORE_ORDER_COOKIE_PREFIX = "opticastylo_store_order_";
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function createStoreSessionCookie(token, maxAgeSeconds, environment = process.env) {
  return cookie(STORE_SESSION_COOKIE_NAME, token, maxAgeSeconds, environment);
}

export function createStoreCartCookie(token, maxAgeSeconds, environment = process.env) {
  return cookie(STORE_CART_COOKIE_NAME, token, maxAgeSeconds, environment);
}

export function expireStoreSessionCookie(environment = process.env) {
  return cookie(STORE_SESSION_COOKIE_NAME, "", 0, environment);
}

export function getStoreCartToken(request) {
  return cookieValue(request.headers.get("cookie"), STORE_CART_COOKIE_NAME);
}

export function createStoreOrderCookie(orderId, token, maxAgeSeconds, environment = process.env) {
  if (!ORDER_ID_PATTERN.test(orderId)) throw new TypeError("Identificador de pedido inválido.");
  return cookie(`${STORE_ORDER_COOKIE_PREFIX}${orderId.toLowerCase()}`, token, maxAgeSeconds, environment);
}

export function getStoreOrderToken(request, orderId) {
  return ORDER_ID_PATTERN.test(orderId)
    ? cookieValue(request.headers.get("cookie"), `${STORE_ORDER_COOKIE_PREFIX}${orderId.toLowerCase()}`) ?? getStoreCartToken(request)
    : getStoreCartToken(request);
}

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
