import { AppError } from "./app-error.js";

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

export function readIdempotencyKey(request) {
  const value = request.headers.get("x-idempotency-key");
  if (value == null) return null;
  const normalized = value.trim();
  if (!REQUEST_KEY_PATTERN.test(normalized)) {
    throw new AppError({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "La clave de idempotencia no es válida.",
      status: 400,
    });
  }
  return normalized;
}
