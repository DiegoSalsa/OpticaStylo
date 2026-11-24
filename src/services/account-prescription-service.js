import { createHash } from "node:crypto";
import { AppError } from "../utils/app-error.js";
import { validateAccountPage } from "../validations/account-pagination.js";
import { readPrescriptionImage } from "../integrations/prescriptions/prescription-reader.js";
import {
  claimAccountPrescriptionReading, confirmAccountPrescription, findAccountPrescriptionImage,
  finishAccountPrescriptionReading, listAccountPrescriptions, saveAccountPrescription,
} from "../repositories/account-prescription-repository.js";
import {
  validateExternalPrescriptionData, validateExternalPrescriptionId, validatePrescriptionImage,
  validatePrescriptionImageBytes, validatePrescriptionImageHash,
} from "../validations/store-validation.js";

function notAvailable() {
  return new AppError({ code: "ACCOUNT_PRESCRIPTION_NOT_AVAILABLE", message: "No encontramos esta receta en tu cuenta.", status: 404 });
}

function accountId(account) {
  if (!account?.id) throw new AppError({ code: "CUSTOMER_AUTHENTICATION_REQUIRED", message: "Inicia sesión para ver tus recetas.", status: 401 });
  return account.id;
}

export async function getAccountPrescriptions(account, query) {
  const owner = accountId(account);
  const dependantId = query.get("dependantId");
  return listAccountPrescriptions(owner, dependantId ? validateExternalPrescriptionId(dependantId) : null, validateAccountPage(query));
}

export async function uploadAccountPrescription(account, file, dependantId = null) {
  const owner = accountId(account);
  const image = validatePrescriptionImage(file);
  const data = validatePrescriptionImageBytes(Buffer.from(await image.file.arrayBuffer()), image.mediaType);
  if (data.length !== image.size) throw new AppError({ code: "INVALID_PRESCRIPTION_IMAGE", message: "El archivo recibido está incompleto.", status: 400 });
  const record = await saveAccountPrescription(owner, { ...image, data, sha256: createHash("sha256").update(data).digest("hex") }, dependantId ? validateExternalPrescriptionId(dependantId) : null);
  if (!record) throw notAvailable();
  return record;
}

export async function readAccountPrescription(account, prescriptionId, dependencies = {}) {
  const owner = accountId(account);
  const id = validateExternalPrescriptionId(prescriptionId);
  const claim = await (dependencies.claimReading ?? claimAccountPrescriptionReading)(owner, id);
  if (claim.reason === "NOT_FOUND") throw notAvailable();
  if (claim.reason === "READING") throw new AppError({ code: "PRESCRIPTION_EXTRACTION_IN_PROGRESS", message: "Estamos leyendo esta receta. Vuelve a consultarla en unos segundos.", status: 409 });
  if (claim.cached) return claim.prescription;
  const finish = dependencies.finishReading ?? finishAccountPrescriptionReading;
  try {
    const extraction = await (dependencies.readImage ?? readPrescriptionImage)(claim.image);
    const record = await finish(owner, id, claim.requestId, extraction);
    if (!record) throw notAvailable();
    return record;
  } catch (error) {
    await finish(owner, id, claim.requestId, null);
    if (error?.code?.startsWith("PRESCRIPTION_READER_")) throw new AppError({
      code: error.code, status: error.status,
      message: "No pudimos leer la receta en este momento. Tu archivo sigue guardado; vuelve a intentar la lectura.",
    });
    throw error;
  }
}

export async function saveReviewedAccountPrescription(account, prescriptionId, input) {
  const owner = accountId(account);
  const id = validateExternalPrescriptionId(prescriptionId);
  const hash = validatePrescriptionImageHash(input?.imageHash);
  const data = validateExternalPrescriptionData(input);
  const record = await confirmAccountPrescription(owner, id, hash, data);
  if (!record) throw new AppError({ code: "ACCOUNT_PRESCRIPTION_REVIEW_REQUIRED", message: "Abre la receta, espera su lectura y revisa los valores antes de guardarla.", status: 409 });
  return record;
}

export async function downloadAccountPrescription(account, prescriptionId) {
  const record = await findAccountPrescriptionImage(accountId(account), validateExternalPrescriptionId(prescriptionId));
  if (!record?.file_data) throw notAvailable();
  return { data: record.file_data, filename: record.original_filename, mediaType: record.media_type };
}
