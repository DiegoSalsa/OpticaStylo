import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import { createCustomer, updateCustomer } from "../../src/services/customer-service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const patientId = "00000000-0000-4000-8000-000000000002";
const customerId = "00000000-0000-4000-8000-000000000003";
const actor = { permissions: [PERMISSIONS.CUSTOMERS_MANAGE], userId };
const details = {
  address: "Calle 1", email: "persona@example.com", firstNames: "Ana",
  lastNames: "Pérez", phone: "+56912345678", rut: "12345678-5",
};

test("crea un cliente copiando los datos básicos de un paciente", async () => {
  const result = await createCustomer({ patientId }, actor, {
    findPatientById: async () => ({ ...details, id: patientId }),
    createCustomer: async (data, actorId) => {
      assert.equal(data.patientId, patientId);
      assert.equal(actorId, userId);
      return { ...data, id: customerId };
    },
  });
  assert.equal(result.id, customerId);
});

test("diferencia un vínculo de paciente duplicado", async () => {
  await assert.rejects(() => createCustomer({ ...details, patientId }, actor, {
    createCustomer: async () => {
      const error = new Error("duplicate"); error.code = "23505";
      error.constraint = "customers_patient_id_key"; throw error;
    },
  }), (error) => error.code === "PATIENT_ALREADY_HAS_CUSTOMER");
});

test("actualiza el snapshot comercial sin cambiar el vínculo", async () => {
  const result = await updateCustomer(customerId, { phone: "+56999999999" }, actor, {
    findCustomerById: async () => ({ ...details, id: customerId, patientId }),
    updateCustomer: async (id, data) => ({ ...data, id }),
  });
  assert.equal(result.phone, "+56999999999");
  assert.equal(result.patientId, patientId);
});
