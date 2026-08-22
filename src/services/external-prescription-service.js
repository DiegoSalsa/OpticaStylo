import { createHash } from "node:crypto";

import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  createPointOfSaleExternalPrescription as createPosPrescriptionRepository,
  findExternalPrescriptionById,
  findExternalPrescriptionFileById,
  listExternalPrescriptionsByPatient,
} from "../repositories/external-prescription-repository.js";
import { findPatientById } from "../repositories/patient-repository.js";
import { AppError } from "../utils/app-error.js";
import { validatePatientId } from "../validations/patient-validation.js";
import {
  validateExternalPrescriptionData,
  validateExternalPrescriptionId,
  validatePrescriptionImage,
  validatePrescriptionImageBytes,
} from "../validations/store-validation.js";

function notFound() {
  throw new AppError({
    code: "EXTERNAL_PRESCRIPTION_NOT_FOUND",
    message: "No se encontró la receta externa.",
    status: 404,
  });
}

function normalizeNotes(value) {
  if (value == null || value === "") return null;
  const notes = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!notes || notes.length > 1000) {
    throw new AppError({
      code: "INVALID_PRESCRIPTION_DATA",
      message: "Las notas de la receta no pueden superar 1000 caracteres.",
      status: 400,
    });
  }
  return notes;
}

async function ensurePatient(patientId, dependencies) {
  const id = validatePatientId(patientId);
  const patient = await (dependencies.findPatientById ?? findPatientById)(id);
  if (!patient) {
    throw new AppError({ code: "PATIENT_NOT_FOUND", message: "No se encontró el paciente.", status: 404 });
  }
  return id;
}

async function createWithRepository(data, actor, dependencies) {
  const result = await (
    dependencies.createPrescription ?? createPosPrescriptionRepository
  )(data, actor.userId);
  if (result.reason === "CUSTOMER_NOT_FOUND") {
    throw new AppError({ code: "CUSTOMER_NOT_FOUND", message: "No se encontró el cliente.", status: 404 });
  }
  if (result.reason === "PATIENT_NOT_FOUND") {
    throw new AppError({ code: "PATIENT_NOT_FOUND", message: "No se encontró el paciente.", status: 404 });
  }
  return result.prescription;
}

export async function createPointOfSaleExternalPrescription(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_CREATE]);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({ code: "INVALID_PRESCRIPTION_IMAGE", message: "Los datos de la receta no son válidos.", status: 400 });
  }
  const customerId = validateExternalPrescriptionId(input.customerId);
  const patientId = await ensurePatient(input.patientId, dependencies);
  const confirmedData = validateExternalPrescriptionData(input.confirmedData);
  let file = { data: null, filename: null, mediaType: null, sha256: null, size: null, source: "MANUAL" };
  if (input.image) {
    const image = validatePrescriptionImage(input.image);
    const data = validatePrescriptionImageBytes(
      Buffer.from(await image.file.arrayBuffer()),
      image.mediaType,
    );
    if (data.length !== image.size) {
      throw new AppError({ code: "INVALID_PRESCRIPTION_IMAGE", message: "El tamaño recibido no coincide con el archivo declarado.", status: 400 });
    }
    file = {
      data,
      filename: image.filename,
      mediaType: image.mediaType,
      sha256: createHash("sha256").update(data).digest("hex"),
      size: data.length,
      source: "IMAGE",
    };
  }
  return createWithRepository({
    ...file,
    confirmedAt: dependencies.currentDate ?? new Date(),
    confirmedData,
    customerId,
    patientId,
  }, actor, dependencies);
}

export async function createExternalPrescription(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_CREATE]);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({ code: "INVALID_PRESCRIPTION_DATA", message: "Los datos de la receta no son válidos.", status: 400 });
  }
  const customerId = validateExternalPrescriptionId(input.customerId);
  const patientId = await ensurePatient(input.patientId, dependencies);
  const source = typeof input.source === "string" ? input.source.trim().toUpperCase() : "";
  const confirmedAt = dependencies.currentDate ?? new Date();
  if (source === "MANUAL") {
    return createWithRepository({
      confirmedAt,
      confirmedData: validateExternalPrescriptionData(input.data),
      customerId,
      data: null,
      filename: null,
      mediaType: null,
      patientId,
      sha256: null,
      size: null,
      source,
    }, actor, dependencies);
  }
  if (source === "IMAGE") {
    const image = validatePrescriptionImage(input.file);
    const data = validatePrescriptionImageBytes(
      Buffer.from(await image.file.arrayBuffer()),
      image.mediaType,
    );
    return createWithRepository({
      confirmedAt,
      confirmedData: { notes: normalizeNotes(input.notes) },
      customerId,
      data,
      filename: image.filename,
      mediaType: image.mediaType,
      patientId,
      sha256: createHash("sha256").update(data).digest("hex"),
      size: data.length,
      source,
    }, actor, dependencies);
  }
  throw new AppError({ code: "INVALID_PRESCRIPTION_SOURCE", message: "La receta externa debe registrarse manualmente o mediante imagen.", status: 400 });
}

export async function getExternalPrescriptionList(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const patientId = await ensurePatient(searchParams.get("patientId"), dependencies);
  return (dependencies.listByPatient ?? listExternalPrescriptionsByPatient)(patientId);
}

export async function getExternalPrescription(id, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const prescription = await (dependencies.findPrescription ?? findExternalPrescriptionById)(
    validateExternalPrescriptionId(id),
  );
  if (!prescription) notFound();
  return prescription;
}

export async function getExternalPrescriptionFile(id, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const file = await (dependencies.findFile ?? findExternalPrescriptionFileById)(
    validateExternalPrescriptionId(id),
  );
  if (!file) notFound();
  return file;
}
