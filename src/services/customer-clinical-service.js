import {
  createCustomerPatientOtpChallenge,
  findCustomerClinicalOverview,
  findCustomerClinicalPage,
  verifyCustomerPatientOtpChallenge,
} from "../repositories/customer-clinical-repository.js";
import { getTransactionalEmailConfig } from "../config/transactional-email.js";
import { processTransactionalEmailById } from "./transactional-email-service.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCustomerPatientLinkRequest,
  validateCustomerPatientOtpInput,
} from "../validations/customer-clinical-validation.js";
import { validateExternalPrescriptionId } from "../validations/store-validation.js";
import { validateAccountPage } from "../validations/account-pagination.js";
import { APPOINTMENT_STATUSES } from "../validations/appointment-validation.js";

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

// Informar un fallo de entrega con el mismo error genérico para no facilitar enumeración.
function throwOtpDeliveryReason() {
  throw new AppError({
    code: "CUSTOMER_PATIENT_LINK_FAILED",
    message: GENERIC_LINK_MESSAGE,
    status: 409,
  });
}

// Exigir un modo de correo entregable antes de crear un desafío que el usuario no podrá recibir.
function assertOtpEmailConfigured(environment, emailConfig) {
  const config = emailConfig ?? getTransactionalEmailConfig(environment);
  if (!["live", "test"].includes(config.mode)) throwOtpDeliveryReason();
  return config;
}

// Consultar únicamente las reservas y recetas permitidas para la cuenta autenticada.
export async function getCustomerClinicalOverview(account, dependencies = {}) {
  const dependantId = dependencies.dependantId ? validateExternalPrescriptionId(dependencies.dependantId) : null;
  return (dependencies.findOverview ?? findCustomerClinicalOverview)(accountId(account), dependencies.now?.() ?? new Date(), {
    ...dependencies.repositoryDependencies, ...(dependantId && { dependantId }),
  });
}

const clinicalRecordTypes = ["upcoming", "appointment-history", "active-prescriptions", "prescription-history", "encounters"];

export async function getCustomerClinicalPage(account, query) {
  const owner = accountId(account);
  const type = query.get("type");
  const status = query.get("status");
  const dependant = query.get("dependantId");
  const dependantId = dependant === null ? null : validateExternalPrescriptionId(dependant);
  if (!clinicalRecordTypes.includes(type) || (type === "encounters" && !dependantId)
    || (status && (type !== "appointment-history" || !APPOINTMENT_STATUSES.includes(status)))) {
    throw new AppError({ code: "INVALID_CLINICAL_HISTORY", message: "El tipo de historial o filtro no es válido.", status: 400 });
  }
  return findCustomerClinicalPage(owner, { dependantId, now: new Date(), pagination: validateAccountPage(query), status, type });
}

// Verificar identidad y generar un desafío sin aceptar correo receptor ni patientId desde el navegador.
export async function requestCustomerPatientLinkCode(account, input, dependencies = {}) {
  const normalized = validateCustomerPatientLinkRequest(input, dependencies.currentDate ?? new Date());
  const authenticatedAccountId = accountId(account);
  if (!dependencies.createChallenge) {
    try {
      assertOtpEmailConfigured(dependencies.environment, dependencies.emailConfig);
    } catch (error) {
      if (error?.code === "CUSTOMER_PATIENT_LINK_FAILED") throw error;
      throwOtpDeliveryReason();
    }
  }
  if (!dependencies.createChallenge && ((dependencies.repositoryDependencies?.environment ?? process.env).CUSTOMER_PATIENT_OTP_SECRET?.trim().length ?? 0) < 32) {
    throw new AppError({
      code: "CUSTOMER_PATIENT_LINK_UNAVAILABLE",
      message: "La verificación clínica por correo no está disponible. Contacta a la óptica.",
      status: 503,
    });
  }
  const result = await (dependencies.createChallenge ?? createCustomerPatientOtpChallenge)(authenticatedAccountId, normalized, dependencies.repositoryDependencies ?? {});
  if (result.reason === "ALREADY_LINKED" && result.samePatient) return { challengeSent: false, linked: true, patient: result.patient };
  if (result.reason === "ALREADY_LINKED") throwLinkReason(result.reason);
  if (result.reason) throwIdentityReason();
  if (result.outboxId) {
    try {
      const config = assertOtpEmailConfigured(dependencies.environment, dependencies.emailConfig);
      const delivery = await (dependencies.processImmediateEmail ?? processTransactionalEmailById)(result.outboxId, dependencies.emailProcessorDependencies ?? {});
      if (delivery.sent !== 1 || !["live", "test"].includes(config.mode)) throwOtpDeliveryReason();
    } catch (error) {
      if (error?.code === "CUSTOMER_PATIENT_LINK_FAILED") throw error;
      throwOtpDeliveryReason();
    }
  }
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
