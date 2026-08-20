import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  findExternalPrescriptionById,
  findExternalPrescriptionFileById,
} from "../repositories/store-repository.js";
import { createPointOfSaleExternalPrescription as createPosPrescriptionRepository } from "../repositories/external-prescription-repository.js";
import { createHash } from "node:crypto";
import { AppError } from "../utils/app-error.js";
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

export async function getExternalPrescription(id, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const prescription = await (
    dependencies.findPrescription ?? findExternalPrescriptionById
  )(validateExternalPrescriptionId(id));
  if (!prescription) notFound();
  return prescription;
}

export async function getExternalPrescriptionFile(
  id,
  actor,
  dependencies = {},
) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const file = await (
    dependencies.findFile ?? findExternalPrescriptionFileById
  )(validateExternalPrescriptionId(id));
  if (!file) notFound();
  return file;
}

export async function createPointOfSaleExternalPrescription(
  input,
  actor,
  dependencies = {},
) {
  requirePermissions(actor, [PERMISSIONS.SALES_CREATE]);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError({
      code: "INVALID_PRESCRIPTION_IMAGE",
      message: "Los datos de la receta no son válidos.",
      status: 400,
    });
  }
  const confirmedData = validateExternalPrescriptionData(input.confirmedData);
  const customerId = validateExternalPrescriptionId(input.customerId);
  let file = {
    data: null,
    filename: null,
    mediaType: null,
    sha256: null,
    size: null,
    source: "MANUAL",
  };
  if (input.image) {
    const image = validatePrescriptionImage(input.image);
    const data = validatePrescriptionImageBytes(
      Buffer.from(await image.file.arrayBuffer()),
      image.mediaType,
    );
    if (data.length !== image.size) {
      throw new AppError({
        code: "INVALID_PRESCRIPTION_IMAGE",
        message: "El tamaño recibido no coincide con el archivo declarado.",
        status: 400,
      });
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
  const result = await (
    dependencies.createPrescription ?? createPosPrescriptionRepository
  )(
    {
      ...file,
      confirmedAt: dependencies.currentDate ?? new Date(),
      confirmedData,
      customerId,
    },
    actor.userId,
  );
  if (result.reason === "CUSTOMER_NOT_FOUND") {
    throw new AppError({
      code: "CUSTOMER_NOT_FOUND",
      message: "No se encontró el cliente.",
      status: 404,
    });
  }
  return result.prescription;
}
