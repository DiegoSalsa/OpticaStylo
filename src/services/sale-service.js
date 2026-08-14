import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  changeSaleStatus as changeSaleStatusRepository,
  confirmSale as confirmSaleRepository,
  createSale as createSaleRepository,
  findSaleById,
  listSaleEvents,
  listSales,
  registerSalePayment as registerSalePaymentRepository,
  updateSaleDraft as updateSaleDraftRepository,
} from "../repositories/sale-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateSaleDraftInput,
  validateSaleId,
  validateSaleListQuery,
  validateSalePaymentInput,
  validateSaleStatusInput,
} from "../validations/sale-validation.js";

const REPOSITORY_ERRORS = Object.freeze({
  CUSTOMER_NOT_FOUND: ["CUSTOMER_NOT_FOUND", "No se encontró el cliente de la venta.", 404],
  INVALID_STATUS_TRANSITION: ["INVALID_SALE_STATUS_TRANSITION", "La venta no admite ese cambio de estado.", 409],
  PAYMENT_EXCEEDS_BALANCE: ["PAYMENT_EXCEEDS_BALANCE", "El abono supera el saldo pendiente.", 409],
  PAYMENT_METHOD_MISMATCH: ["PAYMENT_METHOD_MISMATCH", "Todos los abonos de la venta deben usar el mismo medio de pago.", 409],
  PRESCRIPTION_NOT_FOUND: ["PRESCRIPTION_NOT_FOUND", "No se encontró la receta indicada.", 404],
  PRESCRIPTION_NOT_USABLE: ["PRESCRIPTION_NOT_USABLE", "La receta debe estar activa y pertenecer a una atención finalizada.", 409],
  PRESCRIPTION_REQUIRED: ["PRESCRIPTION_REQUIRED", "La venta incluye lentes que requieren una receta activa.", 409],
  PRODUCT_INACTIVE: ["PRODUCT_INACTIVE", "La venta contiene un producto inactivo.", 409],
  PRODUCT_NOT_FOUND: ["PRODUCT_NOT_FOUND", "No se encontró uno de los productos de la venta.", 404],
  SALE_HAS_PAYMENTS: ["SALE_HAS_PAYMENTS", "Una venta con abonos no puede cancelarse por este flujo.", 409],
  SALE_NOT_CANCELLABLE: ["SALE_NOT_CANCELLABLE", "La venta ya no puede cancelarse.", 409],
  SALE_NOT_CONFIRMABLE: ["SALE_NOT_CONFIRMABLE", "Solo una cotización puede confirmarse.", 409],
  SALE_NOT_EDITABLE: ["SALE_NOT_EDITABLE", "Solo una cotización puede editarse.", 409],
  SALE_NOT_FOUND: ["SALE_NOT_FOUND", "No se encontró la venta.", 404],
  SALE_NOT_PAYABLE: ["SALE_NOT_PAYABLE", "Solo una venta pendiente puede recibir abonos.", 409],
});

function throwRepositoryReason(reason) {
  const [code, message, status] = REPOSITORY_ERRORS[reason] ?? [
    "SALE_OPERATION_REJECTED", "No fue posible realizar la operación comercial.", 409,
  ];
  throw new AppError({ code, message, status });
}

function unwrap(result) {
  if (result.reason) throwRepositoryReason(result.reason);
  return result.sale;
}

export async function createSale(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_CREATE]);
  return unwrap(await (dependencies.createSale ?? createSaleRepository)(
    validateSaleDraftInput(input), actor.userId,
  ));
}

export async function getSale(saleId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const id = validateSaleId(saleId);
  const sale = await (dependencies.findSaleById ?? findSaleById)(id);
  if (!sale) throwRepositoryReason("SALE_NOT_FOUND");
  return sale;
}

export async function getSaleList(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  return (dependencies.listSales ?? listSales)(validateSaleListQuery(searchParams));
}

export async function updateSaleDraft(saleId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_UPDATE]);
  return unwrap(await (dependencies.updateSaleDraft ?? updateSaleDraftRepository)(
    validateSaleId(saleId), validateSaleDraftInput(input), actor.userId,
  ));
}

export async function confirmSale(saleId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_UPDATE]);
  return unwrap(await (dependencies.confirmSale ?? confirmSaleRepository)(
    validateSaleId(saleId), actor.userId,
  ));
}

export async function registerSalePayment(saleId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_PAYMENTS_REGISTER]);
  return unwrap(await (dependencies.registerSalePayment ?? registerSalePaymentRepository)(
    validateSaleId(saleId), validateSalePaymentInput(input), actor.userId,
  ));
}

export async function changeSaleStatus(saleId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_UPDATE]);
  return unwrap(await (dependencies.changeSaleStatus ?? changeSaleStatusRepository)(
    validateSaleId(saleId), validateSaleStatusInput(input), actor.userId,
    dependencies.currentDate ?? new Date(),
  ));
}

export async function getSaleHistory(saleId, actor, dependencies = {}) {
  await getSale(saleId, actor, dependencies);
  return (dependencies.listSaleEvents ?? listSaleEvents)(validateSaleId(saleId));
}
