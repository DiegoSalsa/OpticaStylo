// Servicio de negocio que coordina reglas, permisos y persistencia de virtual-try-on-3d-catalog-service.
import {
  findPublic3dModelFile,
  findPublic3dModelMetadata,
  listActive3dModels,
} from "../repositories/virtual-try-on-3d-repository.js";
import { AppError } from "../utils/app-error.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Centralizar la lógica de id para mantener consistente el comportamiento de la aplicación
function id(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AppError({ code: "INVALID_3D_ASSET_ID", message: "El modelo 3D solicitado no es válido.", status: 400 });
  }
  return value.toLowerCase();
}
// Centralizar la lógica de not found para mantener consistente el comportamiento de la aplicación
function notFound() {
  throw new AppError({ code: "VIRTUAL_TRY_ON_3D_MODEL_NOT_FOUND", message: "No se encontró el modelo 3D.", status: 404 });
}

// Consultar get public3d modelos y devolver los datos en el formato esperado por la capa llamadora
export async function getPublic3dModels(dependencies = {}) {
  return (dependencies.listModels ?? listActive3dModels)();
}
// Consultar get public3d modelo archivo y devolver los datos en el formato esperado por la capa llamadora
export async function getPublic3dModelFile(assetId, dependencies = {}) {
  const file = await (dependencies.findFile ?? findPublic3dModelFile)(id(assetId));
  if (!file) notFound();
  return file;
}
// Consultar get public3d modelo metadatos y devolver los datos en el formato esperado por la capa llamadora
export async function getPublic3dModelMetadata(assetId, dependencies = {}) {
  const result = await (dependencies.findMetadata ?? findPublic3dModelMetadata)(id(assetId));
  if (!result) notFound();
  return result;
}
