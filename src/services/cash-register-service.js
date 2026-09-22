// Servicio de negocio que coordina reglas, permisos y persistencia de cash-register-service.
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  closeCashRegister as closeCashRegisterRepository,
  createCashRegisterMovement as createCashRegisterMovementRepository,
  findOpenCashRegisterSession,
  openCashRegister as openCashRegisterRepository,
} from "../repositories/cash-register-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCashRegisterClosingInput,
  validateCashRegisterId,
  validateCashRegisterMovementInput,
  validateCashRegisterOpeningInput,
} from "../validations/cash-register-validation.js";

// Centralizar la lógica de fail para mantener consistente el comportamiento de la aplicación
function fail(reason) {
  const message = reason === "CASH_REGISTER_NOT_FOUND"
    ? "No se encontró la caja solicitada."
    : "La caja ya está cerrada.";
  throw new AppError({
    code: reason,
    message,
    status: reason === "CASH_REGISTER_NOT_FOUND" ? 404 : 409,
  });
}

// Consultar get open caja caja y devolver los datos en el formato esperado por la capa llamadora
export async function getOpenCashRegister(actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  return (dependencies.findOpenCashRegisterSession ?? findOpenCashRegisterSession)();
}

// Actualizar open caja caja manteniendo las restricciones y estados permitidos del dominio
export async function openCashRegister(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_PAYMENTS_REGISTER]);
  try {
    return await (dependencies.openCashRegister ?? openCashRegisterRepository)(
      validateCashRegisterOpeningInput(input),
      actor.userId,
    );
  } catch (error) {
    if (error?.code === "23505") {
      throw new AppError({
        code: "CASH_REGISTER_ALREADY_OPEN",
        message: "Ya existe una caja de prueba abierta.",
        status: 409,
        cause: error,
      });
    }
    throw error;
  }
}

// Crear o registrar caja caja movimiento aplicando las reglas de negocio y persistencia correspondientes
export async function registerCashMovement(sessionId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_PAYMENTS_REGISTER]);
  const result = await (dependencies.createCashRegisterMovement
    ?? createCashRegisterMovementRepository)(
    validateCashRegisterId(sessionId),
    validateCashRegisterMovementInput(input),
    actor.userId,
  );
  if (result.reason) fail(result.reason);
  return result.session;
}

// Actualizar close caja caja manteniendo las restricciones y estados permitidos del dominio
export async function closeCashRegister(sessionId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_PAYMENTS_REGISTER]);
  const result = await (dependencies.closeCashRegister ?? closeCashRegisterRepository)(
    validateCashRegisterId(sessionId),
    validateCashRegisterClosingInput(input),
    actor.userId,
  );
  if (result.reason) fail(result.reason);
  return result.session;
}
