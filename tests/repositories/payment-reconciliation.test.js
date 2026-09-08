import assert from "node:assert/strict";
import test from "node:test";

import { reconcileMercadoPagoPaymentWithClient } from "../../src/repositories/payment-attempt-repository.js";

const attemptId = "00000000-0000-4000-8000-000000000001";
const saleId = "00000000-0000-4000-8000-000000000002";
const basePayment = {
  currency: "CLP", externalPaymentId: "123456", externalPreferenceId: "preference-1",
  externalReference: attemptId, liveMode: false, status: "approved",
  statusDetail: "accredited", transactionAmount: 49990,
};

function notification(requestId) {
  return { dataId: basePayment.externalPaymentId, eventType: "payment.updated", payload: { action: "payment.updated" }, requestId };
}

function createClient(overrides = {}) {
  const state = {
    attempt: {
      amount_cents: 49990n, currency: "CLP", external_preference_id: "preference-1",
      id: attemptId, initiated_by: null, sale_id: saleId, status: "PENDING",
      ...overrides.attempt,
    },
    eventId: 0n, otherAttemptsBlocked: 0, outboxWrites: 0, paymentWrites: 0,
  };
  return {
    state,
    payment_provider_events: {
      async create() { state.eventId += 1n; return { id: state.eventId }; },
      async update() {},
    },
    payment_attempts: {
      async findFirst() { return { ...state.attempt }; },
      async update({ data }) { Object.assign(state.attempt, data); return state.attempt; },
      async updateMany() { state.otherAttemptsBlocked += 1; return { count: 1 }; },
    },
    sales: {
      async findUnique() {
        return {
          customers: { email: "cliente@example.com" }, sale_number: 42n,
          sale_payments: state.paymentWrites ? [{ amount_cents: 49990n }] : [],
          status: "PENDING", total_cents: 49990n,
        };
      },
      async update() {},
    },
    sale_payments: {
      async create() {
        state.paymentWrites += 1;
        return { id: "00000000-0000-4000-8000-000000000003" };
      },
    },
    sale_events: { async create() {} },
    transactional_email_outbox: {
      async upsert() { state.outboxWrites += 1; },
    },
  };
}

test("acredita una aprobación exacta una sola vez aunque lleguen eventos distintos", async () => {
  const client = createClient();
  const first = await reconcileMercadoPagoPaymentWithClient(client, notification("request-1"), basePayment, { expectedLiveMode: false });
  const second = await reconcileMercadoPagoPaymentWithClient(client, notification("request-2"), basePayment, { expectedLiveMode: false });
  assert.equal(first.result, "APPROVED");
  assert.equal(second.result, "APPROVED");
  assert.equal(client.state.paymentWrites, 1);
  assert.equal(client.state.outboxWrites, 1);
});

test("un monto manipulado bloquea el intento y nunca registra el pago", async () => {
  const client = createClient();
  const result = await reconcileMercadoPagoPaymentWithClient(client, notification("request-fraud"), { ...basePayment, transactionAmount: 49989 }, { expectedLiveMode: false });
  assert.equal(result.result, "REQUIRES_REVIEW");
  assert.equal(client.state.attempt.status, "REQUIRES_REVIEW");
  assert.equal(client.state.paymentWrites, 0);
});

test("un intento en revisión no puede autoaprobarse con un webhook posterior", async () => {
  const client = createClient({ attempt: { status: "REQUIRES_REVIEW" } });
  const result = await reconcileMercadoPagoPaymentWithClient(client, notification("request-review"), basePayment, { expectedLiveMode: false });
  assert.equal(result.result, "REQUIRES_REVIEW");
  assert.equal(client.state.paymentWrites, 0);
});

test("una aprobación atrasada bloquea otros intentos activos antes de acreditarse", async () => {
  const client = createClient({ attempt: { status: "CANCELLED" } });
  const result = await reconcileMercadoPagoPaymentWithClient(client, notification("request-late"), basePayment, { expectedLiveMode: false });
  assert.equal(result.result, "APPROVED");
  assert.equal(client.state.otherAttemptsBlocked, 1);
  assert.equal(client.state.paymentWrites, 1);
});
