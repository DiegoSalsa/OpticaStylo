import { Prisma } from "@prisma/client";

import { prisma } from "../db/prisma.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

function mapAttempt(row) {
  if (!row) return null;
  return {
    amountCents: Number(row.amount_cents), checkoutUrl: row.checkout_url,
    createdAt: row.created_at, currency: row.currency, expiresAt: row.expires_at,
    externalPaymentId: row.external_payment_id,
    externalPreferenceId: row.external_preference_id, failureReason: row.failure_reason,
    id: row.id, idempotencyKey: row.idempotency_key, initiatedBy: row.initiated_by,
    provider: row.provider, providerStatus: row.provider_status,
    providerStatusDetail: row.provider_status_detail, saleId: row.sale_id,
    sandboxCheckoutUrl: row.sandbox_checkout_url, status: row.status, updatedAt: row.updated_at,
  };
}

export async function reserveMercadoPagoAttempt(saleId, actorUserId, expiresAt) {
  return prisma.$transaction(async (client) => {
    const sale = await client.sales.findUnique({
      include: { sale_payments: true }, where: { id: saleId },
    });
    if (!sale) return { attempt: null, reason: "SALE_NOT_FOUND" };
    if (sale.status !== "PENDING") return { attempt: null, reason: "SALE_NOT_PAYABLE" };
    if (sale.payment_method && sale.payment_method !== "MERCADO_PAGO") {
      return { attempt: null, reason: "PAYMENT_METHOD_MISMATCH" };
    }
    const paid = sale.sale_payments.reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const balanceCents = Number(sale.total_cents) - paid;
    if (balanceCents <= 0) return { attempt: null, reason: "SALE_NOT_PAYABLE" };
    await client.payment_attempts.updateMany({
      data: { failure_reason: "El intento de pago venció.", provider_status: "expired", status: "CANCELLED" },
      where: {
        expires_at: { lte: new Date() }, provider: "MERCADO_PAGO", sale_id: saleId,
        status: { in: ["CREATED", "PENDING"] },
      },
    });
    const active = await client.payment_attempts.findFirst({
      orderBy: { created_at: "desc" },
      where: { provider: "MERCADO_PAGO", sale_id: saleId, status: { in: ["CREATED", "PENDING", "APPROVED"] } },
    });
    if (active) {
      if (Number(active.amount_cents) !== balanceCents && active.status !== "APPROVED") {
        await client.payment_attempts.update({ data: {
          failure_reason: "El saldo de la venta cambió después de crear el cobro.",
          status: "REQUIRES_REVIEW",
        }, where: { id: active.id } });
        return { attempt: null, reason: "PAYMENT_ATTEMPT_REQUIRES_REVIEW" };
      }
      return { attempt: mapAttempt(active), reason: null };
    }
    const created = await client.payment_attempts.create({ data: {
      amount_cents: balanceCents, expires_at: expiresAt, initiated_by: actorUserId,
      provider: "MERCADO_PAGO", sale_id: saleId,
    } });
    return { attempt: mapAttempt(created), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function attachMercadoPagoPreference(attemptId, preference) {
  const result = await prisma.payment_attempts.updateMany({ data: {
    checkout_url: preference.checkoutUrl, external_preference_id: preference.externalPreferenceId,
    failure_reason: null, sandbox_checkout_url: preference.sandboxCheckoutUrl, status: "PENDING",
  }, where: { id: attemptId, status: "CREATED" } });
  return result.count ? mapAttempt(await prisma.payment_attempts.findUnique({ where: { id: attemptId } })) : null;
}

export async function markPaymentAttemptFailed(attemptId, reason) {
  const result = await prisma.payment_attempts.updateMany({
    data: { failure_reason: reason.slice(0, 500), status: "FAILED" },
    where: { id: attemptId, status: "CREATED" },
  });
  return result.count ? mapAttempt(await prisma.payment_attempts.findUnique({ where: { id: attemptId } })) : null;
}

export async function listPaymentAttemptsBySaleId(saleId) {
  return (await prisma.payment_attempts.findMany({
    orderBy: [{ created_at: "desc" }, { id: "desc" }], where: { sale_id: saleId },
  })).map(mapAttempt);
}

export function mapProviderStatus(status) {
  if (status === "approved") return "APPROVED";
  if (["pending", "in_process", "authorized"].includes(status)) return "PENDING";
  if (status === "rejected") return "REJECTED";
  if (["cancelled", "expired"].includes(status)) return "CANCELLED";
  return "REQUIRES_REVIEW";
}

export function isValidPaymentExternalReference(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function paymentMatchesAttempt(attempt, payment, expectedLiveMode) {
  const amount = Number(payment.transactionAmount);
  const expectedAmount = Number(attempt.amount_cents);
  return Number.isSafeInteger(amount) && Number.isSafeInteger(expectedAmount) && amount > 0
    && amount === expectedAmount && payment.currency === attempt.currency
    && (expectedLiveMode === undefined || payment.liveMode === expectedLiveMode)
    && Boolean(attempt.external_preference_id && payment.externalPreferenceId
      && payment.externalPreferenceId === attempt.external_preference_id);
}

async function finishProviderEvent(client, eventId, status, error = null) {
  await client.payment_provider_events.update({
    data: { processed_at: new Date(), processing_error: error, processing_status: status },
    where: { id: eventId },
  });
}

export async function reconcileMercadoPagoPayment(notification, payment, options = {}) {
  return prisma.$transaction(
    (client) => reconcileMercadoPagoPaymentWithClient(client, notification, payment, options),
    { isolationLevel: "Serializable" },
  );
}

export async function reconcileMercadoPagoPaymentWithClient(client, notification, payment, options = {}) {
  let event;
  try {
    event = await client.payment_provider_events.create({ data: {
      event_type: notification.eventType, external_object_id: notification.dataId,
      payload: notification.payload, provider: "MERCADO_PAGO", request_id: notification.requestId,
    } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { duplicate: true, result: "ALREADY_PROCESSED" };
    }
    throw error;
  }
  if (!isValidPaymentExternalReference(payment.externalReference)) {
    await finishProviderEvent(client, event.id, "IGNORED", "La referencia externa no es válida.");
    return { duplicate: false, result: "UNKNOWN_PAYMENT" };
  }
  const attempt = await client.payment_attempts.findFirst({
    where: { id: payment.externalReference, provider: "MERCADO_PAGO" },
  });
  if (!attempt) {
    await finishProviderEvent(client, event.id, "IGNORED", "No corresponde a un intento conocido.");
    return { duplicate: false, result: "UNKNOWN_PAYMENT" };
  }
  if (!paymentMatchesAttempt(attempt, payment, options.expectedLiveMode)) {
    const reason = "Los datos confirmados por Mercado Pago no coinciden con el cobro reservado.";
    await client.payment_attempts.update({ data: {
      external_payment_id: payment.externalPaymentId, failure_reason: reason,
      provider_status: payment.status, provider_status_detail: payment.statusDetail,
      status: "REQUIRES_REVIEW",
    }, where: { id: attempt.id } });
    await finishProviderEvent(client, event.id, "FAILED", reason);
    return { duplicate: false, result: "REQUIRES_REVIEW" };
  }
  const mappedStatus = mapProviderStatus(payment.status);
  if (attempt.status === "REQUIRES_REVIEW") {
    await finishProviderEvent(client, event.id, "FAILED", "El intento permanece bloqueado hasta completar su revision manual.");
    return { duplicate: false, paymentAttemptId: attempt.id, result: "REQUIRES_REVIEW", saleId: attempt.sale_id };
  }
  if (attempt.status === "APPROVED" && mappedStatus !== "APPROVED") {
    await client.payment_attempts.update({ data: {
      failure_reason: "Un pago previamente aprobado cambió de estado y requiere revisión.",
      provider_status: payment.status, provider_status_detail: payment.statusDetail,
      status: "REQUIRES_REVIEW",
    }, where: { id: attempt.id } });
    await client.sale_events.create({ data: {
      details: JSON.stringify({ externalPaymentId: payment.externalPaymentId, provider: "MERCADO_PAGO", status: payment.status }),
      event_type: "PAYMENT_STATUS_CHANGED", performed_by: null, sale_id: attempt.sale_id,
    } });
    await finishProviderEvent(client, event.id, "PROCESSED");
    return { duplicate: false, paymentAttemptId: attempt.id, result: "REQUIRES_REVIEW", saleId: attempt.sale_id };
  }
  if (mappedStatus === "APPROVED" && attempt.status !== "APPROVED") {
    await client.payment_attempts.updateMany({ data: {
      failure_reason: "Otro intento de la venta fue aprobado primero.", status: "REQUIRES_REVIEW",
    }, where: {
      id: { not: attempt.id }, provider: "MERCADO_PAGO", sale_id: attempt.sale_id,
      status: { in: ["CREATED", "PENDING"] },
    } });
  }
  await client.payment_attempts.update({ data: {
    external_payment_id: payment.externalPaymentId, failure_reason: null,
    provider_status: payment.status, provider_status_detail: payment.statusDetail,
    status: mappedStatus,
  }, where: { id: attempt.id } });
  if (mappedStatus === "APPROVED" && attempt.status !== "APPROVED") {
    const sale = await client.sales.findUnique({ include: { customers: true, sale_payments: true }, where: { id: attempt.sale_id } });
    const paidCents = sale.sale_payments.reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const totalCents = Number(sale.total_cents);
    if (sale.status !== "PENDING" || paidCents + Number(attempt.amount_cents) > totalCents) {
      const reason = "La venta cambió y el pago aprobado requiere conciliación manual.";
      await client.payment_attempts.update({ data: { failure_reason: reason, status: "REQUIRES_REVIEW" }, where: { id: attempt.id } });
      await finishProviderEvent(client, event.id, "FAILED", reason);
      return { duplicate: false, result: "REQUIRES_REVIEW" };
    }
    const createdPayment = await client.sale_payments.create({ data: {
      amount_cents: attempt.amount_cents, payment_method: "MERCADO_PAGO",
      provider_attempt_id: attempt.id, received_by: attempt.initiated_by,
      reference: `MP:${payment.externalPaymentId}`, sale_id: attempt.sale_id, source: "PROVIDER",
    } });
    const newStatus = paidCents + Number(attempt.amount_cents) === totalCents ? "PAID" : "PENDING";
    await client.sales.update({ data: {
      payment_method: "MERCADO_PAGO", status: newStatus,
      ...(attempt.initiated_by ? { updated_by: attempt.initiated_by } : {}),
    }, where: { id: attempt.sale_id } });
    await client.sale_events.create({ data: {
      details: JSON.stringify({ amountCents: Number(attempt.amount_cents), externalPaymentId: payment.externalPaymentId, paymentMethod: "MERCADO_PAGO", source: "PROVIDER" }),
      event_type: "PAYMENT_REGISTERED", new_status: newStatus,
      performed_by: null, previous_status: "PENDING", sale_id: attempt.sale_id,
    } });
    if (sale.customers?.email) {
      const key = transactionalEmailDeduplicationKey("PAYMENT_CONFIRMED", createdPayment.id);
      await client.transactional_email_outbox.upsert({
        create: {
          deduplication_key: key,
          payload: { amountCents: Number(attempt.amount_cents), saleNumber: Number(sale.sale_number) },
          payment_id: createdPayment.id, recipient_email: sale.customers.email,
          sale_id: attempt.sale_id, template_code: "PAYMENT_CONFIRMED",
        }, update: {}, where: { deduplication_key: key },
      });
    }
  }
  await finishProviderEvent(client, event.id, "PROCESSED");
  return { duplicate: false, paymentAttemptId: attempt.id, result: mappedStatus, saleId: attempt.sale_id };
}
