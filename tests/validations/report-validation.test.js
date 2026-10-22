import assert from "node:assert/strict";
import test from "node:test";
import { validateSalesReportQuery } from "../../src/validations/report-validation.js";

test("normaliza filtros acotados de reporte", () => {
  const result = validateSalesReportQuery(
    new URLSearchParams({
      from: "2026-08-01",
      origin: "online",
      status: "paid",
      to: "2026-08-20",
    }),
  );
  assert.equal(result.origin, "ONLINE");
  assert.equal(result.status, "PAID");
  // Agosto corresponde al horario de invierno de Chile, cuatro horas detrás de UTC.
  assert.equal(result.fromDate.toISOString(), "2026-08-01T04:00:00.000Z");
  assert.equal(result.toDate.toISOString(), "2026-08-21T04:00:00.000Z");
});
test("el reporte usa el día local y conserva el cambio al horario de verano", () => {
  const current = validateSalesReportQuery(new URLSearchParams(), new Date("2026-10-22T01:00:00Z"));
  assert.equal(current.to, "2026-10-21");
  const transition = validateSalesReportQuery(new URLSearchParams({ from: "2026-09-05", to: "2026-09-06" }));
  assert.equal(transition.fromDate.toISOString(), "2026-09-05T04:00:00.000Z");
  assert.equal(transition.toDate.toISOString(), "2026-09-07T03:00:00.000Z");
});
test("rechaza reportes mayores a un año", () =>
  assert.throws(() =>
    validateSalesReportQuery(
      new URLSearchParams({ from: "2024-01-01", to: "2026-01-01" }),
    ),
  ));
