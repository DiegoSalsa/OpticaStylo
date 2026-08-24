import { verifyPassword } from "../auth/password.js";
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  beginDiscountAuthorizationAttempt,
  completeDiscountAuthorizationAttempt,
} from "../repositories/discount-authorization-repository.js";
import { createDiscountAuthorizationGrant } from "../repositories/discount-authorization-grant-repository.js";
import {
  changeSaleStatus as changeSaleStatusRepository,
  confirmSale as confirmSaleRepository,
  createSale as createSaleRepository,
  findReceiptBySaleId,
  findSaleById,
  issueSaleReceipt as issueSaleReceiptRepository,
  listSaleEvents,
  listSales,
  registerSalePayment as registerSalePaymentRepository,
  updateSaleDraft as updateSaleDraftRepository,
} from "../repositories/sale-repository.js";
import { findUserForPermissionAuthorization } from "../repositories/user-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateReceiptInput,
  validateSaleDraftInput,
  validateSaleId,
  validateSaleListQuery,
  validateSaleOperation,
  validateSalePaymentInput,
  validateSaleStatusInput,
} from "../validations/sale-validation.js";
import { validateDiscountAuthorizationInput } from "../validations/discount-authorization-validation.js";

const REPOSITORY_ERRORS = Object.freeze({
  CUSTOMER_NOT_FOUND: ["CUSTOMER_NOT_FOUND", "No se encontró el cliente de la venta.", 404],
  CASH_REGISTER_CLOSED: ["CASH_REGISTER_CLOSED", "Debe abrir la caja de prueba antes de registrar efectivo.", 409],
  DISCOUNT_EXCEEDS_SUBTOTAL: ["DISCOUNT_EXCEEDS_SUBTOTAL", "El descuento debe ser menor que el subtotal de la venta.", 409],
  DISCOUNT_EXCEEDS_TOTAL: ["DISCOUNT_EXCEEDS_TOTAL", "El descuento debe ser menor que el total de la venta.", 409],
  DISCOUNT_AUTHORIZATION_INVALID: ["DISCOUNT_AUTHORIZATION_INVALID", "La autorización de descuento venció, ya fue utilizada o no coincide con esta operación.", 409],
  RECEIPT_PAYMENT_REQUIRED: ["RECEIPT_PAYMENT_REQUIRED", "El comprobante de un abono debe identificar el pago registrado.", 409],
  EXTERNAL_PRESCRIPTION_NOT_FOUND: ["EXTERNAL_PRESCRIPTION_NOT_FOUND", "No se encontró la receta externa indicada.", 404],
  EXTERNAL_PRESCRIPTION_NOT_USABLE: ["EXTERNAL_PRESCRIPTION_NOT_USABLE", "La receta externa debe pertenecer al cliente y paciente de la venta.", 409],
  INVALID_STATUS_TRANSITION: ["INVALID_SALE_STATUS_TRANSITION", "La venta no admite ese cambio de estado.", 409],
  INVALID_LENS_MOUNT: ["INVALID_LENS_MOUNT", "Los cristales deben vincularse a una montura incluida en la venta.", 409],
  LENS_MOUNT_REQUIRED: ["LENS_MOUNT_REQUIRED", "Debe indicar la montura vendida o la montura del cliente para los cristales.", 409],
  PATIENT_NOT_FOUND: ["PATIENT_NOT_FOUND", "No se encontró el paciente de la venta.", 404],
  PAYMENT_ATTEMPT_ACTIVE: ["PAYMENT_ATTEMPT_ACTIVE", "Existe un cobro electrónico pendiente para esta venta.", 409],
  PAYMENT_EXCEEDS_BALANCE: ["PAYMENT_EXCEEDS_BALANCE", "El abono supera el saldo pendiente.", 409],
  PAYMENT_NOT_FOUND: ["PAYMENT_NOT_FOUND", "No se encontró el abono indicado para el comprobante.", 404],
  PAYMENT_METHOD_MISMATCH: ["PAYMENT_METHOD_MISMATCH", "Todos los abonos deben usar el mismo medio de pago.", 409],
  PRESCRIPTION_NOT_FOUND: ["PRESCRIPTION_NOT_FOUND", "No se encontró la receta indicada.", 404],
  PRESCRIPTION_NOT_USABLE: ["PRESCRIPTION_NOT_USABLE", "La receta debe estar activa y utilizable.", 409],
  PRESCRIPTION_PATIENT_MISMATCH: ["PRESCRIPTION_PATIENT_MISMATCH", "La receta no pertenece al paciente seleccionado.", 409],
  PRESCRIPTION_REQUIRED: ["PRESCRIPTION_REQUIRED", "La venta incluye lentes que requieren receta.", 409],
  PRODUCT_INACTIVE: ["PRODUCT_INACTIVE", "La venta contiene un producto inactivo.", 409],
  PRODUCT_NOT_FOUND: ["PRODUCT_NOT_FOUND", "No se encontró uno de los productos.", 404],
  QUOTATION_EXPIRED: ["QUOTATION_EXPIRED", "La cotización venció y debe actualizarse.", 409],
  RECEIPT_NOT_AVAILABLE: ["RECEIPT_NOT_AVAILABLE", "El comprobante requiere una venta confirmada.", 409],
  SALE_HAS_PAYMENTS: ["SALE_HAS_PAYMENTS", "Una venta con abonos no puede cancelarse por este flujo.", 409],
  SALE_NOT_CANCELLABLE: ["SALE_NOT_CANCELLABLE", "La venta ya no puede cancelarse.", 409],
  SALE_NOT_CONFIRMABLE: ["SALE_NOT_CONFIRMABLE", "Solo una cotización puede confirmarse.", 409],
  SALE_NOT_EDITABLE: ["SALE_NOT_EDITABLE", "Solo una cotización puede editarse.", 409],
  SALE_NOT_FOUND: ["SALE_NOT_FOUND", "No se encontró la venta.", 404],
  SALE_NOT_PAYABLE: ["SALE_NOT_PAYABLE", "Solo una venta pendiente puede recibir abonos.", 409],
  UNEXPECTED_LENS_MOUNT: ["UNEXPECTED_LENS_MOUNT", "Solo los cristales pueden tener una montura asociada.", 409],
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

async function authorizeDiscountRequest(input, actor, dependencies) {
  const findAuthorizer = dependencies.findDiscountAuthorizer ?? findUserForPermissionAuthorization;
  const passwordVerifier = dependencies.verifyPassword ?? verifyPassword;
  const beginAttempt = dependencies.beginDiscountAuthorizationAttempt
    ?? beginDiscountAuthorizationAttempt;
  const completeAttempt = dependencies.completeDiscountAuthorizationAttempt
    ?? completeDiscountAuthorizationAttempt;
  const attempt = await beginAttempt({
    attemptedBy: actor.userId,
    authorizerEmail: input.authorizerEmail,
  });
  if (!attempt.allowed) {
    throw new AppError({
      code: "DISCOUNT_AUTHORIZATION_RATE_LIMITED",
      message: "Se alcanzó el límite temporal de intentos para autorizar descuentos.",
      status: 429,
    });
  }

  let authorizer = null;
  let authorized = false;
  try {
    authorizer = await findAuthorizer(
      input.authorizerEmail,
      PERMISSIONS.SALES_DISCOUNTS_AUTHORIZE,
    );
    const passwordIsValid = authorizer
      ? await passwordVerifier(input.authorizerPassword, authorizer.passwordHash)
      : false;
    const isLocked = authorizer?.lockedUntil && authorizer.lockedUntil > new Date();
    authorized = Boolean(
      authorizer && authorizer.isActive && !isLocked && passwordIsValid,
    );
  } finally {
    await completeAttempt(attempt.attemptId, {
      authorizerUserId: authorizer?.id ?? null,
      succeeded: authorized,
    });
  }
  if (!authorized) {
    throw new AppError({
      code: "DISCOUNT_AUTHORIZATION_FAILED",
      message: "Las credenciales no permiten autorizar descuentos.",
      status: 403,
    });
  }
  return authorizer.id;
}

export async function createSale(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_CREATE]);
  const draft = validateSaleDraftInput(input);
  const operation = validateSaleOperation(input.operation);
  return unwrap(await (dependencies.createSale ?? createSaleRepository)(
    draft,
    actor.userId,
    {
      requestKey: dependencies.requestKey ?? null,
      status: operation === "SALE" ? "PENDING" : "QUOTATION",
    },
  ));
}

export async function grantDiscountAuthorization(input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_CREATE]);
  const request = validateDiscountAuthorizationInput(input);
  const authorizedBy = await authorizeDiscountRequest(request, actor, dependencies);
  const currentDate = dependencies.currentDate ?? new Date();
  const expiresAt = new Date(currentDate.getTime() + 5 * 60 * 1000);
  return (dependencies.createDiscountAuthorizationGrant
    ?? createDiscountAuthorizationGrant)({
    amountCents: request.amountCents,
    authorizedBy,
    expiresAt,
    reason: request.reason,
    requestedBy: actor.userId,
  });
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
  const draft = validateSaleDraftInput(input);
  return unwrap(await (dependencies.updateSaleDraft ?? updateSaleDraftRepository)(
    validateSaleId(saleId), draft, actor.userId,
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
    { requestKey: dependencies.requestKey ?? null },
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

export async function issueSaleReceipt(saleId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const id = validateSaleId(saleId);
  const receiptInput = validateReceiptInput(input);
  const result = await (dependencies.issueSaleReceipt ?? issueSaleReceiptRepository)(
    id, receiptInput, actor.userId,
  );
  if (result.reason) throwRepositoryReason(result.reason);
  return result.receipt;
}

export async function getSaleReceipt(saleId, receiptId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const receipt = await (dependencies.findReceiptBySaleId ?? findReceiptBySaleId)(
    validateSaleId(saleId),
    receiptId ? validateSaleId(receiptId, "comprobante") : null,
  );
  if (!receipt) throwRepositoryReason("RECEIPT_NOT_AVAILABLE");
  return receipt;
}
