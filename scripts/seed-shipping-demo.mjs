import { prisma } from "../src/db/prisma.js";
import { shippingConfiguration } from "../src/config/shipping.js";
import { evaluation, requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { inventoryDemo } from "../tests/inventory/data.js";
import { mutateInventory } from "../src/repositories/inventory-repository.js";
import { shippingDemo, logistics, origin, packaging } from "../tests/shipping/data.js";
requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
if (!shippingConfiguration().synthetic) throw new Error("Este seed requiere el simulador aislado.");
try {
  await prisma.branches.update({ where: { id: inventoryDemo.branches[0] }, data: { shipping_enabled: true, shipping_origin: origin } });
  await prisma.shipping_packaging.create({ data: packaging });
  for (const [index, id] of shippingDemo.products.entries()) {
    await prisma.products.create({ data: { id, sku: `DESPACHO-SINTETICO-${index + 1}`, name: `Armazón despacho SINTÉTICO ${index + 1}`, category: "FRAME", inventory_mode: "TRACKED", shipping_logistics: logistics,
      unit_price_cents: [79990,100000,100001,149990][index], is_test_data: true, created_by: evaluation.adminId, updated_by: evaluation.adminId } });
    await mutateInventory({ branchId: inventoryDemo.branches[0], productId: id, kind: "COUNT", quantity: 100, expectedVersion: null, reason: "Conteo exclusivamente sintético para fase 6" }, { userId: evaluation.adminId, permissions: ["inventory.manage_all"] }, `shipping-seed:${index}`);
  }
  console.log("Cuatro productos con pesos y embalajes SINTÉTICOS; un origen habilitado. No usar datos físicos en producción.");
} finally { await prisma.$disconnect(); }
