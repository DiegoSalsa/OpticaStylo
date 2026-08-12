import { findActiveSessionByTokenHash } from "../repositories/session-repository.js";
import { AppError } from "../utils/app-error.js";
import { hashSessionToken, SESSION_COOKIE_NAME } from "./session-token.js";

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

function throwAuthenticationRequired() {
  throw new AppError({
    code: "AUTHENTICATION_REQUIRED",
    message: "Debe iniciar sesión para realizar esta operación.",
    status: 401,
  });
}

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
