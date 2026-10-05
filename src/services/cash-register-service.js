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

export async function getOpenCashRegister(actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  return (dependencies.findOpenCashRegisterSession ?? findOpenCashRegisterSession)();
}

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
