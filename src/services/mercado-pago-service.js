import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  getMercadoPagoConfig,
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

export async function createMercadoPagoCheckout(
  saleId,
  actor,
  dependencies = {},
) {
  requirePermissions(actor, [PERMISSIONS.SALES_MERCADO_PAGO_CHECKOUT]);
  const id = validateSaleId(saleId);
  const currentDate = dependencies.currentDate ?? new Date();
  const expiresAt = new Date(currentDate.getTime() + 30 * 60 * 1000);
  const reservation = await (
    dependencies.reserveMercadoPagoAttempt ?? reserveMercadoPagoAttempt
  )(id, actor.userId, expiresAt);
  if (reservation.reason) throwAttemptReason(reservation.reason);

  const attempt = reservation.attempt;
  if (attempt.checkoutUrl) return attempt;

  const sale = await (dependencies.findSaleById ?? findSaleById)(id);
  if (!sale) throwAttemptReason("SALE_NOT_FOUND");
  const config = (dependencies.getMercadoPagoConfig ?? getMercadoPagoConfig)(
    dependencies.environment,
  );

  try {
    const preference = await (
      dependencies.createMercadoPagoPreference ?? createMercadoPagoPreference
    )({ attempt, config, sale });
    if (!preference.externalPreferenceId || !preference.checkoutUrl) {
      throw new Error("Mercado Pago devolvió una preferencia incompleta.");
    }
    return await (
      dependencies.attachMercadoPagoPreference ?? attachMercadoPagoPreference
    )(attempt.id, preference);
  } catch (error) {
    await (dependencies.markPaymentAttemptFailed ?? markPaymentAttemptFailed)(
      attempt.id,
      "No fue posible crear la preferencia en Mercado Pago.",
    );
    throw providerUnavailable(error);
  }
}

export async function getMercadoPagoCheckouts(saleId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.SALES_READ]);
  const id = validateSaleId(saleId);
  const sale = await (dependencies.findSaleById ?? findSaleById)(id);
  if (!sale) throwAttemptReason("SALE_NOT_FOUND");
  return (dependencies.listPaymentAttemptsBySaleId ?? listPaymentAttemptsBySaleId)(id);
}

export async function processMercadoPagoNotification(input, dependencies = {}) {
  const notification = validateMercadoPagoNotification(input);
  const config = (dependencies.getMercadoPagoConfig ?? getMercadoPagoConfig)(
    dependencies.environment,
  );
  const secret = (dependencies.requireWebhookSecret ?? requireMercadoPagoWebhookSecret)(config);

  try {
    (dependencies.validateSignature ?? validateMercadoPagoSignature)({
      dataId: notification.dataId,
      secret,
      xRequestId: notification.requestId,
      xSignature: notification.signature,
    });
  } catch (error) {
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
    throw providerUnavailable(error);
  }

  return (dependencies.reconcileMercadoPagoPayment ?? reconcileMercadoPagoPayment)(
    notification,
    payment,
  );
}
