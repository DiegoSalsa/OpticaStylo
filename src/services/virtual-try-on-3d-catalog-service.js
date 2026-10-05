import {
  findPublic3dModelFile,
  findPublic3dModelMetadata,
  listActive3dModels,
} from "../repositories/virtual-try-on-3d-repository.js";
import { AppError } from "../utils/app-error.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AppError({ code: "INVALID_3D_ASSET_ID", message: "El modelo 3D solicitado no es válido.", status: 400 });
  }
  return value.toLowerCase();
}
function notFound() {
  throw new AppError({ code: "VIRTUAL_TRY_ON_3D_MODEL_NOT_FOUND", message: "No se encontró el modelo 3D.", status: 404 });
}

export async function getPublic3dModels(dependencies = {}) {
  return (dependencies.listModels ?? listActive3dModels)();
}
export async function getPublic3dModelFile(assetId, dependencies = {}) {
  const file = await (dependencies.findFile ?? findPublic3dModelFile)(id(assetId));
  if (!file) notFound();
  return file;
}
export async function getPublic3dModelMetadata(assetId, dependencies = {}) {
  const result = await (dependencies.findMetadata ?? findPublic3dModelMetadata)(id(assetId));
  if (!result) notFound();
  return result;
}
