import assert from "node:assert/strict";
import { test } from "node:test";
import { commercialQuery, preferencesInput, contactInput, commercialReportQuery } from "../../src/validations/customer-commercial-validation.js";
import { validateCreateCustomerInput } from "../../src/validations/customer-validation.js";
import { commercialDemo } from "./data.js";
test("Cliente ocasional admite solo nombre y normaliza RUT y contacto", () => {
  assert.equal(validateCreateCustomerInput({
    firstNames: "Ocasional"
  }).rut, null);
  const input = validateCreateCustomerInput({
    ...commercialDemo.customer,
    rut: commercialDemo.customer.rut.replace(/(\d)(?=(\d{3})+-)/g, "$1.")
  });
  assert.equal(input.rut, commercialDemo.customer.rut);
  assert.throws(() => validateCreateCustomerInput({
    firstNames: "x",
    phone: "abc"
  }));
});
test("Segmentos y páginas tienen límites; preferencias son opcionales y declaradas", () => {
  assert.equal(commercialQuery(new URLSearchParams("segment=REPEAT&days=365")).days, 365);
  assert.throws(() => commercialQuery(new URLSearchParams("pageSize=1000")));
  assert.throws(() => preferencesInput({
    expectedVersion: 1,
    preferences: {
      diagnosis: "dato no permitido"
    }
  }));
  assert.deepEqual(preferencesInput({
    expectedVersion: 1,
    preferences: {
      brands: ["A", "A"]
    }
  }).preferences.brands, ["A"]);
});
test("Publicidad requiere confirmación expresa y permite oposición", () => {
  assert.throws(() => contactInput({
    channel: "EMAIL",
    decision: "GRANTED",
    source: "IN_PERSON"
  }));
  assert.equal(contactInput({
    channel: "EMAIL",
    decision: "REVOKED",
    source: "IN_PERSON"
  }).decision, "REVOKED");
});
test("Reporte usa límites de días en Santiago y valida fechas", () => {
  const q = commercialReportQuery(new URLSearchParams("from=2026-10-01&to=2026-10-31"));
  assert.equal(q.fromDate.toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(q.toDate.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.throws(() => commercialReportQuery(new URLSearchParams("from=2026-02-30")));
});
