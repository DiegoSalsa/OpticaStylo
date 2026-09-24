import {
  createCustomerPatientOtpChallenge,
  findCustomerClinicalOverview,
  verifyCustomerPatientOtpChallenge,
} from "../repositories/customer-clinical-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCustomerPatientLinkRequest,
  validateCustomerPatientOtpInput,
} from "../validations/customer-clinical-validation.js";

const GENERIC_LINK_MESSAGE = "No fue posible verificar un registro de paciente con los datos proporcionados.";

// Resolver el contexto clínico siempre desde la cuenta autenticada de la sesión.
function accountId(account) {
  if (!account?.id) {
    throw new AppError({
      code: "CUSTOMER_AUTHENTICATION_REQUIRED",
      message: "Debe iniciar sesión como cliente para realizar esta operación.",
      status: 401,
    });
  }
  return account.id;
}

// Traducir fallos de identidad y conflictos únicos sin revelar qué dato coincidió.
function throwLinkReason(reason) {
  if (reason === "ALREADY_LINKED") {
    throw new AppError({
      code: "CUSTOMER_PATIENT_ALREADY_LINKED",
      message: "La cuenta ya está vinculada a otro registro de atención.",
      status: 409,
    });
  }
  if (reason === "PATIENT_LINKED") {
    throw new AppError({
      code: "CUSTOMER_PATIENT_LINK_CONFLICT",
      message: GENERIC_LINK_MESSAGE,
      status: 409,
    });
  }
  throw new AppError({
    code: "CUSTOMER_PATIENT_LINK_FAILED",
    message: GENERIC_LINK_MESSAGE,
    status: 409,
  });
}

// Traducir cualquier fallo previo al OTP con un mensaje uniforme contra enumeración.
function throwIdentityReason() {
  throw new AppError({
    code: "CUSTOMER_PATIENT_LINK_FAILED",
    message: GENERIC_LINK_MESSAGE,
    status: 409,
  });
}

// Consultar únicamente las reservas y recetas permitidas para la cuenta autenticada.
export async function getCustomerClinicalOverview(account, dependencies = {}) {
  return (dependencies.findOverview ?? findCustomerClinicalOverview)(accountId(account), dependencies.now?.() ?? new Date(), dependencies.repositoryDependencies ?? {});
}

// Verificar identidad y generar un desafío sin aceptar correo receptor ni patientId desde el navegador.
export async function requestCustomerPatientLinkCode(account, input, dependencies = {}) {
  const normalized = validateCustomerPatientLinkRequest(input, dependencies.currentDate ?? new Date());
  const result = await (dependencies.createChallenge ?? createCustomerPatientOtpChallenge)(accountId(account), normalized, dependencies.repositoryDependencies ?? {});
  if (result.reason === "ALREADY_LINKED" && result.samePatient) return { challengeSent: false, linked: true, patient: result.patient };
  if (result.reason === "ALREADY_LINKED") throwLinkReason(result.reason);
  if (result.reason) throwIdentityReason();
  return { challengeSent: true, expiresAt: result.expiresAt, maskedEmail: result.maskedEmail };
}

// Verificar el código y completar el vínculo únicamente una vez demostrado el control del correo.
export async function confirmCustomerPatientLink(account, input, dependencies = {}) {
  const normalized = validateCustomerPatientOtpInput(input);
  const result = await (dependencies.verifyChallenge ?? verifyCustomerPatientOtpChallenge)(accountId(account), normalized.code, dependencies.repositoryDependencies ?? {});
  if (["OTP_INVALID", "OTP_EXPIRED", "OTP_ATTEMPTS"].includes(result.reason)) {
    throw new AppError({
      code: "CUSTOMER_PATIENT_OTP_INVALID",
      message: "No fue posible verificar el código de vinculación.",
      status: 409,
    });
  }
  if (result.reason) throwLinkReason(result.reason);
  return { linked: true, patient: result.patient };
}
