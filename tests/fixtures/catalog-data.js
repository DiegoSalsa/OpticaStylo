import { prisma } from "../../src/db/prisma.js";
import { requireIsolatedStoreDatabase, seedStoreE2e } from "../../scripts/seed-store-e2e.mjs";

// Más de dos páginas con precios y fechas que contradicen el orden alfabético.
export async function seedCatalogData() {
  requireIsolatedStoreDatabase();
  await seedStoreE2e();
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(3, "0");
    await prisma.products.upsert({ where: { sku: `DEMO-CATALOGO-${suffix}` }, update: {}, create: {
      sku: `DEMO-CATALOGO-${suffix}`, name: `CatalogoDemo${suffix}`, category: index % 2 ? "FRAME" : "ACCESSORY",
      unit_price_cents: 1000 + (54 - index) * 100, created_at: new Date(Date.UTC(2026, 9, 1, 0, index)), is_test_data: true,
      created_by: "00000000-0000-4000-8000-000000000099", updated_by: "00000000-0000-4000-8000-000000000099",
    } });
  }
}
