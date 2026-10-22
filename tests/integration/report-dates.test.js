import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/db/prisma.js";
import { seedAcademicData, ids } from "../fixtures/academic-data.js";
import { getSalesReport } from "../../src/services/report-service.js";

test("reportes PostgreSQL: los límites y el día del agregado pertenecen a Santiago", { skip: process.env.ACADEMIC_ISOLATION !== "true" }, async () => {
  try {
    const { admin } = await seedAcademicData();
    // Las operaciones externas al día local permiten detectar un corte accidental en UTC.
    await prisma.sales.createMany({ data: [
      ["2026-10-22T02:59:59Z", 1000], ["2026-10-22T03:00:00Z", 2000],
      ["2026-10-23T02:59:59Z", 3000], ["2026-10-23T03:00:00Z", 4000],
    ].map(([createdAt, total]) => ({ created_at: new Date(createdAt), status: "PENDING", total_cents: total, subtotal_cents: total, created_by: ids.sales })) });
    const report = await getSalesReport(new URLSearchParams({ from: "2026-10-22", to: "2026-10-22" }), admin);
    assert.equal(report.summary.operationCount, 2);
    assert.equal(report.summary.totalCents, 5000);
    assert.deepEqual(report.daily, [{ day: "2026-10-22", count: 2, totalCents: 5000 }]);
  } finally { await prisma.$disconnect(); }
});
