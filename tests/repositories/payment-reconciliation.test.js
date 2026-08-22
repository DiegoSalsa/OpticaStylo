import assert from "node:assert/strict";
import test from "node:test";

import { reconcileMercadoPagoPaymentWithClient } from "../../src/repositories/payment-attempt-repository.js";

const attemptId = "00000000-0000-4000-8000-000000000001";
const saleId = "00000000-0000-4000-8000-000000000002";
const basePayment = {
  currency: "CLP",
  externalPaymentId: "123456",
  externalPreferenceId: "preference-1",
  externalReference: attemptId,
  liveMode: false,
  status: "approved",
  statusDetail: "accredited",
  transactionAmount: 49990,
};

function notification(requestId) {
  return {
    dataId: basePayment.externalPaymentId,
    eventType: "payment.updated",
    payload: { action: "payment.updated", data: { id: basePayment.externalPaymentId } },
    requestId,
  };
}

function createClient(overrides = {}) {
  const state = {
    attempt: {
      amount_cents: 49990,
      currency: "CLP",
      external_preference_id: "preference-1",
      id: attemptId,
      initiated_by: null,
      sale_id: saleId,
      status: "PENDING",
      ...overrides.attempt,
    },
    eventRequests: new Set(),
    otherAttemptsBlocked: 0,
    outboxWrites: 0,
    paymentWrites: 0,
  };
  return {
    state,
    async query(text, parameters = []) {
      if (text.includes("INSERT INTO payment_provider_events")) {
        if (state.eventRequests.has(parameters[0])) return { rowCount: 0, rows: [] };
        state.eventRequests.add(parameters[0]);
        return { rowCount: 1, rows: [{ id: state.eventRequests.size }] };
      }
      if (text.includes("SELECT * FROM payment_attempts")) {
        return { rowCount: 1, rows: [{ ...state.attempt }] };
      }
      if (text.includes("id <> $2") && text.includes("payment_attempts")) {
        state.otherAttemptsBlocked += 1;
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("SET status = $2, external_payment_id")) {
        state.attempt.status = parameters[1];
        state.attempt.external_payment_id = parameters[2];
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("SET status = 'REQUIRES_REVIEW'") && text.includes("payment_attempts")) {
        state.attempt.status = "REQUIRES_REVIEW";
        return { rowCount: 1, rows: [] };
      }
      if (text.includes("SELECT sales.status")) {
        return {
          rowCount: 1,
          rows: [{
            customer_email: "cliente@example.com",
            sale_number: 42,
            status: "PENDING",
            total_cents: 49990,
          }],
        };
      }
      if (text.includes("COALESCE(SUM(amount_cents)")) {
        return { rowCount: 1, rows: [{ paid_cents: state.paymentWrites * 49990 }] };
      }
      if (text.includes("INSERT INTO sale_payments")) {
        state.paymentWrites += 1;
        return {
          rowCount: 1,
          rows: [{ id: "00000000-0000-4000-8000-000000000003" }],
        };
      }
      if (text.includes("INSERT INTO transactional_email_outbox")) {
        state.outboxWrites += 1;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

test("acredita una aprobación exacta una sola vez aunque lleguen eventos distintos", async () => {
  const client = createClient();
  const first = await reconcileMercadoPagoPaymentWithClient(
    client, notification("request-1"), basePayment, { expectedLiveMode: false },
  );
  const second = await reconcileMercadoPagoPaymentWithClient(
    client, notification("request-2"), basePayment, { expectedLiveMode: false },
  );
  assert.equal(first.result, "APPROVED");
  assert.equal(second.result, "APPROVED");
  assert.equal(client.state.paymentWrites, 1);
  assert.equal(client.state.outboxWrites, 1);
});

test("un monto manipulado bloquea el intento y nunca registra el pago", async () => {
  const client = createClient();
  const result = await reconcileMercadoPagoPaymentWithClient(
    client,
    notification("request-fraud"),
    { ...basePayment, transactionAmount: 49989 },
    { expectedLiveMode: false },
  );
  assert.equal(result.result, "REQUIRES_REVIEW");
  assert.equal(client.state.attempt.status, "REQUIRES_REVIEW");
  assert.equal(client.state.paymentWrites, 0);
});

test("un intento en revisión no puede autoaprobarse con un webhook posterior", async () => {
  const client = createClient({ attempt: { status: "REQUIRES_REVIEW" } });
  const result = await reconcileMercadoPagoPaymentWithClient(
    client, notification("request-review"), basePayment, { expectedLiveMode: false },
  );
  assert.equal(result.result, "REQUIRES_REVIEW");
  assert.equal(client.state.paymentWrites, 0);
});

test("una aprobación atrasada bloquea otros intentos activos antes de acreditarse", async () => {
  const client = createClient({ attempt: { status: "CANCELLED" } });
  const result = await reconcileMercadoPagoPaymentWithClient(
    client, notification("request-late"), basePayment, { expectedLiveMode: false },
  );
  assert.equal(result.result, "APPROVED");
  assert.equal(client.state.otherAttemptsBlocked, 1);
  assert.equal(client.state.paymentWrites, 1);
});
