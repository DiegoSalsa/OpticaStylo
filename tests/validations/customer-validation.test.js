import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreateCustomerInput,
  validateCustomerListQuery,
  validateUpdateCustomerInput,
} from "../../src/validations/customer-validation.js";

const patientId = "00000000-0000-4000-8000-000000000001";
const customer = {
  address: " Avenida Central 123 ", email: "CLIENTE@EXAMPLE.COM",
  firstNames: " María  José ", lastNames: " Pérez Soto ", patientId,
  phone: "+56 9 1234 5678", rut: "12.345.678-5",
};

test("normaliza un cliente independiente o vinculado", () => {
  const result = validateCreateCustomerInput(customer);
  assert.equal(result.rut, "12345678-5");
  assert.equal(result.phone, "+56912345678");
  assert.equal(result.email, "cliente@example.com");
});

test("permite crear un cliente copiando un paciente", () => {
  assert.deepEqual(validateCreateCustomerInput({ patientId }), {
    copyPatientData: true, patientId,
  });
});

test("rechaza actualizar el vínculo paciente por accidente", () => {
  assert.throws(
    () => validateUpdateCustomerInput({ patientId: null }, { ...customer, patientId }),
    /al menos un dato comercial/,
  );
});

test("rechaza vaciar un dato comercial obligatorio", () => {
  assert.throws(
    () => validateUpdateCustomerInput({ phone: null }, { ...customer, patientId }),
    /teléfono no es válido/,
  );
});

test("valida la búsqueda paginada de clientes", () => {
  assert.deepEqual(validateCustomerListQuery(new URLSearchParams("page=2&pageSize=5&search=Perez")), {
    page: 2, pageSize: 5, search: "Perez",
  });
});
