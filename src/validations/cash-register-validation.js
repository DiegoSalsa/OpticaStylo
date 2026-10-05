import { AppError } from "../utils/app-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new AppError({ code: "INVALID_CASH_REGISTER_DATA", message, status: 400 });
}

function notes(value, label) {
  if (value == null || value === "") return null;
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!normalized || normalized.length > 500) {
    fail(`${label} debe tener hasta 500 caracteres.`);
  }
  return normalized;
}

function amount(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} debe ser un entero igual o mayor a ${minimum}.`);
  }
  return value;
}

export function validateCashRegisterId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail("El identificador de caja no es válido.");
  }
  return value.toLowerCase();
}

export function validateCashRegisterOpeningInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cuerpo de apertura no es válido.");
  }
  return {
    openingAmountCents: amount(input.openingAmountCents, "El fondo inicial"),
    openingNotes: notes(input.openingNotes, "La observación de apertura"),
  };
}

export function validateCashRegisterMovementInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El movimiento de caja no es válido.");
  }
  const movementType = typeof input.movementType === "string"
    ? input.movementType.trim().toUpperCase()
    : "";
  if (!["MANUAL_IN", "MANUAL_OUT"].includes(movementType)) {
    fail("El tipo de movimiento de caja no es válido.");
  }
  const reason = notes(input.reason, "El motivo del movimiento");
  if (!reason) fail("El movimiento de caja requiere un motivo.");
  return {
    amountCents: amount(input.amountCents, "El monto del movimiento", 1),
    movementType,
    reason,
  };
}

export function validateCashRegisterClosingInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("El cierre de caja no es válido.");
  }
  return {
    closingCountedCents: amount(input.closingCountedCents, "El arqueo"),
    closingNotes: notes(input.closingNotes, "La observación de cierre"),
  };
}
