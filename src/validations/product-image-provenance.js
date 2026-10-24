import { AppError } from "../utils/app-error.js";
import { inventoryKey } from "../integrations/inventory/romano-image-inventory.js";

function fail(message) {
  throw new AppError({ code: "INVALID_IMAGE_PROVENANCE", message, status: 400 });
}
function required(value, label, limit = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) fail(`${label} no es válido.`);
  return value.trim();
}
export function publicSourceUrl(value) {
  const url = new URL(required(value, "La URL de procedencia", 2000));
  if (url.protocol !== "https:" || url.username || url.password || url.port) fail("La procedencia debe usar HTTPS público sin credenciales.");
  return url.href;
}
export function validateImageProvenance(value) {
  if (value == null) return null;
  const identity = Object.fromEntries(["brand", "model", "color"].map((key) => [key, required(value.identity?.[key], key, 200)]));
  const authorizationStatus = value.authorization?.status;
  const userPublished = authorizationStatus === "USER_PUBLISHED_PENDING_RIGHTS";
  if (!userPublished && (authorizationStatus !== "AUTHORIZED" || value.authorization.commercialUse !== true)) {
    fail("La fotografía necesita autorización comprobada de uso comercial o publicación explícita pendiente de derechos.");
  }
  if (!["EXACT", "EXACT_CODE_CANDIDATE"].includes(value.verification?.status) || value.verification.colorConfirmed !== true) {
    fail("La marca, el modelo y el color deben estar comprobados.");
  }
  const reviewedAt = required(value.verification.reviewedAt, "La fecha de revisión", 40);
  if (!Number.isFinite(Date.parse(reviewedAt)) || Date.parse(reviewedAt) > Date.now()) fail("La fecha de revisión no es válida.");
  if (!Array.isArray(value.inventoryRows) || !value.inventoryRows.length || value.inventoryRows.length > 2000) fail("Falta la trazabilidad del inventario.");
  const inventoryRows = value.inventoryRows.map((row) => ({
    sheet: required(row.sheet, "La hoja", 100), row: row.row,
    originalRow: row.originalRow, block: required(row.block, "El bloque", 20),
  }));
  if (inventoryRows.some((row) => !Number.isSafeInteger(row.row) || row.row < 1 || !Number.isSafeInteger(row.originalRow) || row.originalRow < 1)) fail("Las filas de origen no son válidas.");
  if (!/^[a-f0-9]{64}$/.test(value.workbookSha256 ?? "")) fail("Falta el hash del archivo maestro.");
  return {
    identity, inventoryKey: inventoryKey(identity), inventoryRows, workbookSha256: value.workbookSha256,
    branch: "GALERIA_ROMANO", sourceUrl: publicSourceUrl(value.sourceUrl),
    sourceImageUrl: publicSourceUrl(value.sourceImageUrl),
    view: required(value.view, "La vista", 80),
    authorization: {
      status: authorizationStatus,
      commercialUse: userPublished ? false : true,
      holder: required(value.authorization.holder, "El titular", 200),
      evidenceUrl: publicSourceUrl(value.authorization.evidenceUrl),
      scope: required(value.authorization.scope, "El alcance de la autorización", 1000),
    },
    verification: {
      status: value.verification.status, colorConfirmed: true, reviewedAt,
      reviewedBy: required(value.verification.reviewedBy, "La persona que verificó", 200),
      evidenceUrl: publicSourceUrl(value.verification.evidenceUrl),
      sharedManufacturerPhoto: value.verification.sharedManufacturerPhoto === true,
      ...(value.verification.sharedManufacturerPhoto === true ? { sharedPhotoEvidence: publicSourceUrl(value.verification.sharedPhotoEvidence) } : {}),
    },
  };
}
