import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const OTP_LENGTH = 6;

// Exigir un secreto independiente para la verificación clínica y evitar reutilizar CRON_SECRET.
function otpSecret(environment = process.env) {
  const secret = environment.CUSTOMER_PATIENT_OTP_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("CUSTOMER_PATIENT_OTP_SECRET debe tener al menos 32 caracteres.");
  }
  return secret;
}

// Generar un código numérico temporal sin registrar su valor en logs ni respuestas.
export function generateCustomerPatientOtp(random = randomInt) {
  return String(random(0, 1_000_000)).padStart(OTP_LENGTH, "0");
}

// Calcular el hash HMAC asociado al desafío, sin guardar el código en texto plano.
export function hashCustomerPatientOtp(challengeId, code, environment = process.env) {
  return createHmac("sha256", otpSecret(environment))
    .update(`${challengeId}:${code}`, "utf8")
    .digest("hex");
}

// Comparar códigos mediante una operación de tiempo constante y evitar filtraciones por timing.
export function verifyCustomerPatientOtp(challengeId, code, expectedHash, environment = process.env) {
  const actual = Buffer.from(hashCustomerPatientOtp(challengeId, code, environment), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Enmascarar el destino del desafío sin devolver el correo clínico completo al navegador.
export function maskCustomerPatientEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return "correo registrado";
  const visible = local.length <= 2 ? local[0] : `${local[0]}${"•".repeat(Math.min(3, local.length - 2))}${local.at(-1)}`;
  return `${visible}@${domain}`;
}

// Validar el formato exacto del código antes de consumir un intento.
export function isCustomerPatientOtp(value) {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export const CUSTOMER_PATIENT_OTP_TTL_SECONDS = 10 * 60;
export const CUSTOMER_PATIENT_OTP_MAX_ATTEMPTS = 5;
