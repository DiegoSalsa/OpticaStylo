import assert from "node:assert/strict";
import test from "node:test";
import { PERMISSIONS } from "../../src/auth/permissions.js";
import { getSalesReport } from "../../src/services/report-service.js";

test("entrega agregados solo a administración", async () => {
  const actor = { permissions: [PERMISSIONS.REPORTS_READ] };
  const result = await getSalesReport(
    new URLSearchParams({ from: "2026-08-01", to: "2026-08-20" }),
    actor,
    {
      getSalesReportData: async (query) => ({
        summary: { operationCount: query.from === "2026-08-01" ? 3 : 0 },
      }),
    },
  );
  assert.equal(result.summary.operationCount, 3);
  await assert.rejects(
    () => getSalesReport(new URLSearchParams(), { permissions: [] }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS",
  );
});
