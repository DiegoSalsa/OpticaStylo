import {
  findCustomerClinicalOverview,
  linkCustomerToPatient,
} from "../repositories/customer-clinical-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateCustomerPatientLinkInput } from "../validations/customer-clinical-validation.js";

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

// Consultar únicamente las reservas y recetas permitidas para la cuenta autenticada.
export async function getCustomerClinicalOverview(account, dependencies = {}) {
  return (dependencies.findOverview ?? findCustomerClinicalOverview)(accountId(account), dependencies.now?.() ?? new Date());
}

// Verificar identidad y ejecutar el vínculo sin aceptar patientId desde el navegador.
export async function linkCustomerPatient(account, input, dependencies = {}) {
  const normalized = validateCustomerPatientLinkInput(input, dependencies.currentDate ?? new Date());
  const result = await (dependencies.linkPatient ?? linkCustomerToPatient)(accountId(account), normalized);
  if (result.reason) throwLinkReason(result.reason);
  return { linked: true, patient: result.patient };
}
