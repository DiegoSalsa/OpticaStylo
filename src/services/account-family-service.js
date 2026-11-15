import { AppError } from "../utils/app-error.js";
import { isAdultBirthDate, validateAccountBirthDate } from "../utils/customer-account-age.js";
import { validateCreatePatientInput } from "../validations/patient-validation.js";
import { validateExternalPrescriptionId } from "../validations/store-validation.js";
import { validateCustomerPatientOtpInput } from "../validations/customer-clinical-validation.js";
import { createAccountDependant, createDependantLinkChallenge, listAccountDependants, verifyDependantLinkChallenge } from "../repositories/account-family-repository.js";
import { getTransactionalEmailConfig } from "../config/transactional-email.js";
import { processTransactionalEmailById } from "./transactional-email-service.js";

function requireAdult(account) {
  if (!account?.id) throw new AppError({ code: "CUSTOMER_AUTHENTICATION_REQUIRED", message: "Inicia sesión para gestionar tu cuenta.", status: 401 });
  validateAccountBirthDate(account.birthDate);
}

function verificationFailed() {
  return new AppError({ code: "DEPENDANT_LINK_VERIFICATION_FAILED", message: "No pudimos verificar el acceso a las atenciones. Comprueba los datos del menor y del adulto responsable con la óptica.", status: 409 });
}

export async function getAccountDependants(account) {
  requireAdult(account);
  return listAccountDependants(account.id);
}

export async function addAccountDependant(account, input) {
  requireAdult(account);
  const data = validateCreatePatientInput({
    ...input, email: account.email, phone: account.phone, address: account.address,
    guardian: { firstNames: account.firstNames, lastNames: account.lastNames, rut: account.rut, email: account.email, phone: account.phone, relationship: input?.relationship },
  });
  if (isAdultBirthDate(data.birthDate) || data.rut === account.rut) throw new AppError({ code: "DEPENDANT_MUST_BE_MINOR", message: "Este apartado es para menores de 18 años a tu cargo.", status: 400 });
  try {
    const record = await createAccountDependant(account.id, data);
    if (!record) throw verificationFailed();
    return record;
  } catch (error) {
    if (error?.code === "P2002") throw new AppError({ code: "DEPENDANT_ALREADY_EXISTS", message: "Ese menor ya está registrado en tu cuenta.", status: 409 });
    throw error;
  }
}

export async function requestDependantCode(account, id) {
  requireAdult(account);
  const dependantId = validateExternalPrescriptionId(id);
  const configuration = getTransactionalEmailConfig();
  if (!["live", "test"].includes(configuration.mode) || (process.env.CUSTOMER_PATIENT_OTP_SECRET?.trim().length ?? 0) < 32) throw new AppError({ code: "CUSTOMER_PATIENT_LINK_UNAVAILABLE", message: "La verificación por correo no está disponible. Contacta a la óptica.", status: 503 });
  const result = await createDependantLinkChallenge(account.id, dependantId);
  if (!result) throw verificationFailed();
  const delivery = await processTransactionalEmailById(result.outboxId);
  if (delivery.sent !== 1) throw verificationFailed();
  return { maskedEmail: result.maskedEmail, expiresAt: result.expiresAt };
}

export async function confirmDependantCode(account, id, input) {
  requireAdult(account);
  const dependantId = validateExternalPrescriptionId(id);
  const { code } = validateCustomerPatientOtpInput(input);
  if (!await verifyDependantLinkChallenge(account.id, dependantId, code)) throw verificationFailed();
  return { linked: true };
}
