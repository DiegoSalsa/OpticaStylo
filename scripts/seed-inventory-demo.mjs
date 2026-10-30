import { prisma } from "../src/db/prisma.js";
import { hashPassword } from "../src/auth/password.js";
import { evaluation, requireEvaluationDatabase } from "../tests/evaluation-data.js";
import { inventoryDemo as demo } from "../tests/inventory/data.js";
import { mutateInventory } from "../src/repositories/inventory-repository.js";

requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
try {
  // Solo sobre el clúster sintético: las ubicaciones reales quedan sin stock.
  await prisma.branches.updateMany({ data: { is_active: false } });
  for (const [index, id] of demo.branches.entries()) await prisma.branches.create({ data: {
    id, code: `PRUEBA-${index + 1}`, name: `Sucursal sintética ${String.fromCharCode(65 + index)}`, information_source: "Datos sintéticos exclusivos de pruebas aisladas", pickup_enabled: true,
  } });
  await prisma.users.create({ data: { id: demo.staffId, first_name: "Empleado", last_name: "Sintético", email: demo.staffEmail, password_hash: await hashPassword(evaluation.password) } });
  const role = await prisma.roles.findUniqueOrThrow({ where: { code: "SALES" } });
  await prisma.user_roles.create({ data: { user_id: demo.staffId, role_id: role.id } });
  await prisma.user_branches.create({ data: { user_id: demo.staffId, branch_id: demo.branches[0] } });
  for (const [index, id] of demo.browserProducts.entries()) await prisma.products.create({ data: {
    id, sku: `INV-NAVEGADOR-${index + 1}`, name: `Armazón inventario navegador ${index + 1}`, category: "FRAME", inventory_mode: "TRACKED", unit_price_cents: 1000,
    created_by: evaluation.adminId, updated_by: evaluation.adminId, is_test_data: true,
  } });
  const products = await prisma.products.findMany();
  const actor = { userId: evaluation.adminId, permissions: ["inventory.manage_all"] };
  for (const product of products) {
    const mode = ["PRESCRIPTION_LENS", "TREATMENT"].includes(product.category) ? "ON_DEMAND" : "TRACKED";
    await prisma.products.update({ where: { id: product.id }, data: { inventory_mode: mode } });
    if (mode === "TRACKED") for (const [index, branchId] of demo.branches.entries()) await mutateInventory({ branchId, productId: product.id, kind: "COUNT", quantity: index === 0 ? 1000 : index === 1 ? 3 : 0, expectedVersion: null, reason: "Conteo sintético para demostración aislada" }, actor, `seed:${branchId}:${product.id}`.slice(-80));
  }
  console.log("Tres sucursales sintéticas con conteos auditados preparadas. No se cargó inventario real.");
} finally { await prisma.$disconnect(); }
