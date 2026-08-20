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
  assert.equal(result.toDate.toISOString(), "2026-08-21T00:00:00.000Z");
});
test("rechaza reportes mayores a un año", () =>
  assert.throws(() =>
    validateSalesReportQuery(
      new URLSearchParams({ from: "2024-01-01", to: "2026-01-01" }),
    ),
  ));
