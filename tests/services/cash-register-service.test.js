import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  closeCashRegister,
  openCashRegister,
  registerCashMovement,
} from "../../src/services/cash-register-service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const ventas = {
  permissions: [PERMISSIONS.SALES_PAYMENTS_REGISTER],
  userId,
};

test("abre una caja de prueba con fondo inicial trazable", async () => {
  const session = await openCashRegister({
    openingAmountCents: 50000,
    openingNotes: "Fondo de apertura de prueba",
  }, ventas, {
    openCashRegister: async (input, actorId) => {
      assert.deepEqual(input, {
        openingAmountCents: 50000,
        openingNotes: "Fondo de apertura de prueba",
      });
      assert.equal(actorId, userId);
      return { id: sessionId, status: "OPEN" };
    },
  });
  assert.equal(session.status, "OPEN");
});

test("exige motivo al registrar un movimiento manual", async () => {
  await assert.rejects(() => registerCashMovement(sessionId, {
    amountCents: 3000,
    movementType: "MANUAL_OUT",
    reason: "",
  }, ventas), (error) => error.code === "INVALID_CASH_REGISTER_DATA");
});

test("cierra la caja con arqueo y diferencia calculados por el servidor", async () => {
  const session = await closeCashRegister(sessionId, {
    closingCountedCents: 62000,
    closingNotes: "Arqueo de prueba",
  }, ventas, {
    closeCashRegister: async (id, input, actorId) => {
      assert.equal(id, sessionId);
      assert.equal(input.closingCountedCents, 62000);
      assert.equal(actorId, userId);
      return {
        reason: null,
        session: { differenceCents: -1000, id, status: "CLOSED" },
      };
    },
  });
  assert.equal(session.differenceCents, -1000);
  assert.equal(session.status, "CLOSED");
});

test("impide que un profesional clínico opere caja", async () => {
  await assert.rejects(() => openCashRegister({ openingAmountCents: 0 }, {
    permissions: [], userId,
  }), (error) => error.code === "INSUFFICIENT_PERMISSIONS");
});
