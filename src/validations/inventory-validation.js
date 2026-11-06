import { AppError } from "../utils/app-error.js";
import { validateProductId } from "./product-validation.js";

export const inventoryId = validateProductId;
const fail = (message) => { throw new AppError({ code: "INVALID_INVENTORY_DATA", message, status: 400 }); };
export function inventoryText(value, label, limit = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) fail(`${label} debe contener entre 1 y ${limit} caracteres.`);
  return value.trim();
}
export function inventoryQuantity(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1_000_000) fail("La cantidad debe ser un entero válido entre 0 y 1.000.000 (las entradas y salidas deben ser positivas).");
  return value;
}
export function validateInventoryMovement(input) {
  if (!input || !["COUNT", "ENTRY", "EXIT", "ADJUST"].includes(input.kind)) fail("Seleccione un tipo de movimiento válido.");
  if (input.expectedVersion != null && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)) fail("La versión del inventario no es válida.");
  return { branchId: inventoryId(input.branchId), productId: inventoryId(input.productId), kind: input.kind,
    quantity: inventoryQuantity(input.quantity, ["COUNT","ADJUST"].includes(input.kind)), reason: inventoryText(input.reason, "El motivo u origen"), expectedVersion: input.expectedVersion ?? null };
}
export function validateInventoryTransfer(input) {
  if (input?.id) {
    if (!["RECEIVE","CANCEL"].includes(input.action)) fail("La acción de transferencia no es válida.");
    return { id: inventoryId(input.id), action: input.action };
  }
  const data = { ...validateInventoryMovement({ ...input, kind: "ENTRY" }), destinationId: inventoryId(input.destinationId) };
  if (data.branchId === data.destinationId) fail("El origen y destino deben ser diferentes.");
  return data;
}
