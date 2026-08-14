import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  findExternalPrescriptionById,
  findExternalPrescriptionFileById,
} from "../repositories/store-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateExternalPrescriptionId } from "../validations/store-validation.js";

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

export async function getExternalPrescriptionFile(id, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const file = await (
    dependencies.findFile ?? findExternalPrescriptionFileById
  )(validateExternalPrescriptionId(id));
  if (!file) notFound();
  return file;
}
