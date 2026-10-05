import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  getMercadoPagoConfig,
  requireMercadoPagoCheckoutReady,
  requireMercadoPagoWebhookSecret,
} from "../config/payment-providers.js";
import {
  createMercadoPagoPreference,
  getMercadoPagoPayment,
  validateMercadoPagoSignature,
} from "../integrations/payments/mercado-pago-gateway.js";
import {
  attachMercadoPagoPreference,
  listPaymentAttemptsBySaleId,
  markPaymentAttemptFailed,
  reconcileMercadoPagoPayment,
  reserveMercadoPagoAttempt,
} from "../repositories/payment-attempt-repository.js";
import { findSaleById } from "../repositories/sale-repository.js";
import { AppError } from "../utils/app-error.js";
import { auditMercadoPagoWebhook } from "../utils/payment-monitor.js";
import { validateMercadoPagoNotification } from "../validations/payment-validation.js";
import { validateSaleId } from "../validations/sale-validation.js";

const ATTEMPT_ERRORS = Object.freeze({
  PAYMENT_ATTEMPT_REQUIRES_REVIEW: [
    "PAYMENT_ATTEMPT_REQUIRES_REVIEW",
    "El cobro electrónico requiere revisión antes de continuar.",
  ],
  PAYMENT_METHOD_MISMATCH: [
    "PAYMENT_METHOD_MISMATCH",
    "La venta ya utiliza otro medio de pago.",
  ],
  SALE_NOT_FOUND: ["SALE_NOT_FOUND", "No se encontró la venta."],
  SALE_NOT_PAYABLE: ["SALE_NOT_PAYABLE", "Solo una venta pendiente con saldo puede pagarse."],
});

function throwAttemptReason(reason) {
  const [code, message] = ATTEMPT_ERRORS[reason] ?? [
    "PAYMENT_ATTEMPT_REJECTED",
    "No fue posible iniciar el cobro.",
  ];
  throw new AppError({ code, message, status: reason === "SALE_NOT_FOUND" ? 404 : 409 });
}

function providerUnavailable(cause) {
  return new AppError({
    code: "PAYMENT_PROVIDER_UNAVAILABLE",
    message: "Mercado Pago no se encuentra disponible. Inténtelo nuevamente.",
    status: 502,
    cause,
  });
}

async function createCheckout(saleId, initiatedBy, dependencies) {
  const id = validateSaleId(saleId);
  const config = (dependencies.getMercadoPagoConfig ?? getMercadoPagoConfig)(
    dependencies.environment,
  );
  (dependencies.requireCheckoutReady ?? requireMercadoPagoCheckoutReady)(config);
  const currentDate = dependencies.currentDate ?? new Date();
  const expiresAt = new Date(currentDate.getTime() + 30 * 60 * 1000);
  const sale = await (dependencies.findSaleById ?? findSaleById)(id);
  if (!sale) throwAttemptReason("SALE_NOT_FOUND");
  const reservation = await (
    dependencies.reserveMercadoPagoAttempt ?? reserveMercadoPagoAttempt
  )(id, initiatedBy, expiresAt);
  if (reservation.reason) throwAttemptReason(reservation.reason);

  const attempt = reservation.attempt;
  if (attempt.checkoutUrl) return publicCheckoutAttempt(attempt);

  try {
    const preference = await (
      dependencies.createMercadoPagoPreference ?? createMercadoPagoPreference
    )({ attempt, config, sale });
    if (!preference.externalPreferenceId || !preference.checkoutUrl) {
      throw new Error("Mercado Pago devolvió una preferencia incompleta.");
    }
    return publicCheckoutAttempt(await (
      dependencies.attachMercadoPagoPreference ?? attachMercadoPagoPreference
    )(attempt.id, preference));
  } catch (error) {
    await (dependencies.markPaymentAttemptFailed ?? markPaymentAttemptFailed)(
      attempt.id,
      "No fue posible crear la preferencia en Mercado Pago.",
    );
    throw providerUnavailable(error);
  }
}

function publicCheckoutAttempt(attempt) {
  if (!attempt) return null;
  const { idempotencyKey: _idempotencyKey, ...safeAttempt } = attempt;
  return safeAttempt;
}

export async function createMercadoPagoCheckout(
  saleId,
  actor,
  dependencies = {},
) {
  requirePermissions(actor, [PERMISSIONS.SALES_MERCADO_PAGO_CHECKOUT]);
  return createCheckout(saleId, actor.userId, dependencies);
}

export async function createStoreMercadoPagoCheckout(saleId, dependencies = {}) {
  return createCheckout(saleId, null, dependencies);
}

export async function getMercadoPagoCheckouts(saleId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const id = validateSaleId(saleId);
  const sale = await (dependencies.findSaleById ?? findSaleById)(id);
  if (!sale) throwAttemptReason("SALE_NOT_FOUND");
  const attempts = await (
    dependencies.listPaymentAttemptsBySaleId ?? listPaymentAttemptsBySaleId
  )(id);
  return attempts.map(publicCheckoutAttempt);
}

export async function processMercadoPagoNotification(input, dependencies = {}) {
  const notification = validateMercadoPagoNotification(input);
  const audit = dependencies.auditWebhook ?? auditMercadoPagoWebhook;
  const config = (dependencies.getMercadoPagoConfig ?? getMercadoPagoConfig)(
    dependencies.environment,
  );
  let secret;
  try {
    secret = (dependencies.requireWebhookSecret ?? requireMercadoPagoWebhookSecret)(config);
  } catch (error) {
    audit({ ...notification, outcome: "NOT_CONFIGURED" });
    throw error;
  }

  try {
    (dependencies.validateSignature ?? validateMercadoPagoSignature)({
      dataId: notification.dataId,
      secret,
      xRequestId: notification.requestId,
      xSignature: notification.signature,
    });
  } catch (error) {
    audit({ ...notification, outcome: "INVALID_SIGNATURE" });
    throw new AppError({
      code: "INVALID_PAYMENT_NOTIFICATION_SIGNATURE",
      message: "La firma de la notificación no es válida.",
      status: 401,
      cause: error,
    });
  }

  let payment;
  try {
    payment = await (dependencies.getMercadoPagoPayment ?? getMercadoPagoPayment)(
      notification.dataId,
      config,
    );
  } catch (error) {
    audit({ ...notification, outcome: "PROVIDER_ERROR" });
    throw providerUnavailable(error);
  }

  const result = await (
    dependencies.reconcileMercadoPagoPayment ?? reconcileMercadoPagoPayment
  )(
    notification,
    payment,
    { expectedLiveMode: config.expectedLiveMode },
  );
  audit({
    ...notification,
    outcome: result.result === "REQUIRES_REVIEW" ? "REQUIRES_REVIEW" : result.result,
  });
  return { ...result, emailQueued: result.result === "APPROVED" };
}
