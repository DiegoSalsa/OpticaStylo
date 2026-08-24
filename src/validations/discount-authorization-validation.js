import { AppError } from "../utils/app-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message) {
  throw new AppError({
    code: "INVALID_DISCOUNT_AUTHORIZATION",
    message,
    status: 400,
  });
}

export function validateDiscountAuthorizationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de la autorización no es válido.");
  }
  const amountCents = input.amountCents;
  const authorizerEmail = typeof input.authorizerEmail === "string"
    ? input.authorizerEmail.trim().toLowerCase()
    : "";
  const authorizerPassword = typeof input.authorizerPassword === "string"
    ? input.authorizerPassword
    : "";
  const reason = typeof input.reason === "string"
    ? input.reason.trim().replace(/\s+/g, " ")
    : "";

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    fail("El monto del descuento debe ser un entero positivo expresado en pesos chilenos.");
  }
  if (!reason || reason.length > 300) {
    fail("El motivo del descuento debe tener entre 1 y 300 caracteres.");
  }
  if (!EMAIL_PATTERN.test(authorizerEmail) || authorizerEmail.length > 254) {
    fail("El correo de quien autoriza el descuento no es válido.");
  }
  if (!authorizerPassword || Buffer.byteLength(authorizerPassword, "utf8") > 1_024) {
    fail("La contraseña de autorización no es válida.");
  }

  return { amountCents, authorizerEmail, authorizerPassword, reason };
}
