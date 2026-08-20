import { executeQuery, executeTransaction } from "../db/query.js";

function mapAttempt(row) {
  if (!row) return null;
  return {
    amountCents: Number(row.amount_cents),
    checkoutUrl: row.checkout_url,
    createdAt: row.created_at,
    currency: row.currency,
    expiresAt: row.expires_at,
    externalPaymentId: row.external_payment_id,
    externalPreferenceId: row.external_preference_id,
    failureReason: row.failure_reason,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    initiatedBy: row.initiated_by,
    provider: row.provider,
    providerStatus: row.provider_status,
    providerStatusDetail: row.provider_status_detail,
    saleId: row.sale_id,
    sandboxCheckoutUrl: row.sandbox_checkout_url,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function reserveMercadoPagoAttempt(saleId, actorUserId, expiresAt) {
  return executeTransaction(async (client) => {
    const saleResult = await client.query(
      `SELECT status, payment_method, total_cents
       FROM sales WHERE id = $1 FOR UPDATE`,
      [saleId],
    );
    const sale = saleResult.rows[0];
    if (!sale) return { attempt: null, reason: "SALE_NOT_FOUND" };
    if (sale.status !== "PENDING") return { attempt: null, reason: "SALE_NOT_PAYABLE" };
    if (sale.payment_method && sale.payment_method !== "MERCADO_PAGO") {
      return { attempt: null, reason: "PAYMENT_METHOD_MISMATCH" };
    }

    const paidResult = await client.query(
      "SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM sale_payments WHERE sale_id = $1",
      [saleId],
    );
    const balanceCents = Number(sale.total_cents) - Number(paidResult.rows[0].paid_cents);
    if (balanceCents <= 0) return { attempt: null, reason: "SALE_NOT_PAYABLE" };

    await client.query(
      `UPDATE payment_attempts
       SET status = 'CANCELLED', provider_status = 'expired',
           failure_reason = 'El intento de pago venció.'
       WHERE sale_id = $1 AND provider = 'MERCADO_PAGO'
         AND status IN ('CREATED', 'PENDING')
         AND expires_at <= CURRENT_TIMESTAMP`,
      [saleId],
    );

    const activeResult = await client.query(
      `SELECT * FROM payment_attempts
       WHERE sale_id = $1 AND provider = 'MERCADO_PAGO'
         AND status IN ('CREATED', 'PENDING', 'APPROVED')
       ORDER BY created_at DESC LIMIT 1`,
      [saleId],
    );
    if (activeResult.rows[0]) {
      const attempt = mapAttempt(activeResult.rows[0]);
      if (attempt.amountCents !== balanceCents && attempt.status !== "APPROVED") {
        await client.query(
          `UPDATE payment_attempts
           SET status = 'REQUIRES_REVIEW', failure_reason = $2
           WHERE id = $1`,
          [attempt.id, "El saldo de la venta cambió después de crear el cobro."],
        );
        return { attempt: null, reason: "PAYMENT_ATTEMPT_REQUIRES_REVIEW" };
      }
      return { attempt, reason: null };
    }

    const attemptResult = await client.query(
      `INSERT INTO payment_attempts (
         sale_id, provider, amount_cents, initiated_by, expires_at
       ) VALUES ($1, 'MERCADO_PAGO', $2, $3, $4)
       RETURNING *`,
      [saleId, balanceCents, actorUserId, expiresAt],
    );
    return { attempt: mapAttempt(attemptResult.rows[0]), reason: null };
  });
}

export async function attachMercadoPagoPreference(attemptId, preference) {
  const result = await executeQuery(
    `UPDATE payment_attempts
     SET status = 'PENDING', external_preference_id = $2, checkout_url = $3,
         sandbox_checkout_url = $4, failure_reason = NULL
     WHERE id = $1 AND status = 'CREATED'
     RETURNING *`,
    [attemptId, preference.externalPreferenceId, preference.checkoutUrl,
      preference.sandboxCheckoutUrl],
  );
  return mapAttempt(result.rows[0]);
}

export async function markPaymentAttemptFailed(attemptId, reason) {
  const result = await executeQuery(
    `UPDATE payment_attempts SET status = 'FAILED', failure_reason = $2
     WHERE id = $1 AND status = 'CREATED' RETURNING *`,
    [attemptId, reason.slice(0, 500)],
  );
  return mapAttempt(result.rows[0]);
}

export async function listPaymentAttemptsBySaleId(saleId) {
  const result = await executeQuery(
    `SELECT * FROM payment_attempts WHERE sale_id = $1
     ORDER BY created_at DESC, id DESC`,
    [saleId],
  );
  return result.rows.map(mapAttempt);
}

function mapProviderStatus(status) {
  if (status === "approved") return "APPROVED";
  if (["pending", "in_process", "authorized"].includes(status)) return "PENDING";
  if (status === "rejected") return "REJECTED";
  if (status === "cancelled") return "CANCELLED";
  return "REQUIRES_REVIEW";
}

export function isValidPaymentExternalReference(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function paymentMatchesAttempt(attempt, payment) {
  return Number(payment.transactionAmount) === Number(attempt.amount_cents)
    && payment.currency === attempt.currency
    && Boolean(
      attempt.external_preference_id
      && payment.externalPreferenceId
      && payment.externalPreferenceId === attempt.external_preference_id,
    );
}

async function finishProviderEvent(client, eventId, status, error = null) {
  await client.query(
    `UPDATE payment_provider_events
     SET processing_status = $2, processing_error = $3, processed_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [eventId, status, error],
  );
}

export async function reconcileMercadoPagoPayment(notification, payment) {
  return executeTransaction(async (client) => {
    const eventResult = await client.query(
      `INSERT INTO payment_provider_events (
         provider, request_id, event_type, external_object_id, payload
       ) VALUES ('MERCADO_PAGO', $1, $2, $3, $4::JSONB)
       ON CONFLICT (provider, request_id) DO NOTHING
       RETURNING id`,
      [notification.requestId, notification.eventType, notification.dataId,
        JSON.stringify(notification.payload)],
    );
    if (eventResult.rowCount === 0) return { duplicate: true, result: "ALREADY_PROCESSED" };
    const eventId = eventResult.rows[0].id;

    if (!isValidPaymentExternalReference(payment.externalReference)) {
      await finishProviderEvent(client, eventId, "IGNORED", "La referencia externa no es válida.");
      return { duplicate: false, result: "UNKNOWN_PAYMENT" };
    }

    const attemptResult = await client.query(
      `SELECT * FROM payment_attempts
       WHERE id = $1 AND provider = 'MERCADO_PAGO' FOR UPDATE`,
      [payment.externalReference],
    );
    const attempt = attemptResult.rows[0];
    if (!attempt) {
      await finishProviderEvent(client, eventId, "IGNORED", "No corresponde a un intento conocido.");
      return { duplicate: false, result: "UNKNOWN_PAYMENT" };
    }

    if (!paymentMatchesAttempt(attempt, payment)) {
      const reason = "Los datos confirmados por Mercado Pago no coinciden con el cobro reservado.";
      await client.query(
        `UPDATE payment_attempts SET status = 'REQUIRES_REVIEW',
           external_payment_id = $2, provider_status = $3,
           provider_status_detail = $4, failure_reason = $5 WHERE id = $1`,
        [attempt.id, payment.externalPaymentId, payment.status,
          payment.statusDetail, reason],
      );
      await finishProviderEvent(client, eventId, "FAILED", reason);
      return { duplicate: false, result: "REQUIRES_REVIEW" };
    }

    const mappedStatus = mapProviderStatus(payment.status);
    if (attempt.status === "APPROVED" && mappedStatus !== "APPROVED") {
      const reason = "Un pago previamente aprobado cambió de estado y requiere revisión.";
      await client.query(
        `UPDATE payment_attempts SET status = 'REQUIRES_REVIEW',
           provider_status = $2, provider_status_detail = $3,
           failure_reason = $4 WHERE id = $1`,
        [attempt.id, payment.status, payment.statusDetail, reason],
      );
      await client.query(
        `INSERT INTO sale_events (
           sale_id, event_type, details, performed_by
         ) VALUES ($1, 'PAYMENT_STATUS_CHANGED', $2, NULL)`,
        [attempt.sale_id, JSON.stringify({
          externalPaymentId: payment.externalPaymentId,
          provider: "MERCADO_PAGO",
          status: payment.status,
        })],
      );
      await finishProviderEvent(client, eventId, "PROCESSED");
      return { duplicate: false, result: "REQUIRES_REVIEW" };
    }

    await client.query(
      `UPDATE payment_attempts SET status = $2, external_payment_id = $3,
         provider_status = $4, provider_status_detail = $5, failure_reason = NULL
       WHERE id = $1`,
      [attempt.id, mappedStatus, payment.externalPaymentId, payment.status,
        payment.statusDetail],
    );

    if (mappedStatus === "APPROVED" && attempt.status !== "APPROVED") {
      const saleResult = await client.query(
        `SELECT sales.status, sales.total_cents, customers.email AS customer_email
         FROM sales JOIN customers ON customers.id = sales.customer_id
         WHERE sales.id = $1 FOR UPDATE OF sales`,
        [attempt.sale_id],
      );
      const sale = saleResult.rows[0];
      const paidResult = await client.query(
        "SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM sale_payments WHERE sale_id = $1",
        [attempt.sale_id],
      );
      const paidCents = Number(paidResult.rows[0].paid_cents);
      const totalCents = Number(sale.total_cents);
      if (sale.status !== "PENDING" || paidCents + Number(attempt.amount_cents) > totalCents) {
        const reason = "La venta cambió y el pago aprobado requiere conciliación manual.";
        await client.query(
          "UPDATE payment_attempts SET status = 'REQUIRES_REVIEW', failure_reason = $2 WHERE id = $1",
          [attempt.id, reason],
        );
        await finishProviderEvent(client, eventId, "FAILED", reason);
        return { duplicate: false, result: "REQUIRES_REVIEW" };
      }

      await client.query(
        `INSERT INTO sale_payments (
           sale_id, amount_cents, payment_method, reference, received_by,
           source, provider_attempt_id
         ) VALUES ($1, $2, 'MERCADO_PAGO', $3, $4, 'PROVIDER', $5)`,
        [attempt.sale_id, attempt.amount_cents,
          `MP:${payment.externalPaymentId}`, attempt.initiated_by, attempt.id],
      );
      const newStatus = paidCents + Number(attempt.amount_cents) === totalCents ? "PAID" : "PENDING";
      await client.query(
        `UPDATE sales SET payment_method = 'MERCADO_PAGO', status = $2,
           updated_by = COALESCE($3, updated_by) WHERE id = $1`,
        [attempt.sale_id, newStatus, attempt.initiated_by],
      );
      await client.query(
        `INSERT INTO sale_events (
           sale_id, event_type, previous_status, new_status, details, performed_by
         ) VALUES ($1, 'PAYMENT_REGISTERED', 'PENDING', $2, $3, NULL)`,
        [attempt.sale_id, newStatus, JSON.stringify({
          amountCents: Number(attempt.amount_cents),
          externalPaymentId: payment.externalPaymentId,
          paymentMethod: "MERCADO_PAGO",
          source: "PROVIDER",
        })],
      );
      await client.query(
        `INSERT INTO transactional_email_outbox (
           template_code, recipient_email, payload, deduplication_key
         ) VALUES ('PAYMENT_CONFIRMED', $1, $2::JSONB, $3)
         ON CONFLICT (deduplication_key) DO NOTHING`,
        [sale.customer_email, JSON.stringify({
          amountCents: Number(attempt.amount_cents),
          saleId: attempt.sale_id,
          status: newStatus,
        }), `payment-attempt:${attempt.id}:approved`],
      );
    }

    await finishProviderEvent(client, eventId, "PROCESSED");
    return { duplicate: false, result: mappedStatus };
  });
}
