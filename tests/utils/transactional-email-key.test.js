import assert from "node:assert/strict";
import test from "node:test";

import { transactionalEmailDeduplicationKey } from "../../src/utils/transactional-email-key.js";

const entityId = "00000000-0000-4000-8000-000000000001";
const expected = Object.freeze({
  ACCOUNT_CREATED: `account:${entityId}`,
  APPOINTMENT_CONFIRMED: `appointment-confirmed:${entityId}`,
  APPOINTMENT_REMINDER: `appointment-reminder:${entityId}`,
  ORDER_CONFIRMED: `order-confirmed:${entityId}`,
  PAYMENT_CONFIRMED: `payment-confirmed:${entityId}`,
  POS_FINAL_RECEIPT: `receipt-final:${entityId}`,
  POS_PAYMENT_RECEIPT: `receipt-payment:${entityId}`,
});

for (const [templateCode, key] of Object.entries(expected)) {
  test(`${templateCode} produce una clave idempotente estable`, () => {
    assert.equal(transactionalEmailDeduplicationKey(templateCode, entityId), key);
    assert.equal(transactionalEmailDeduplicationKey(templateCode, entityId), key);
  });
}

test("eventos diferentes no comparten clave", () => {
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length);
});

