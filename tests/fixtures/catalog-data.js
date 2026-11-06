import { prisma } from "../../src/db/prisma.js";
import { requireIsolatedStoreDatabase, seedStoreE2e } from "../../scripts/seed-store-e2e.mjs";
import { requireEvaluationDatabase } from "../evaluation-data.js";
import { requireAcademicIsolation } from "./academic-data.js";
import { mutateInventory } from "../../src/repositories/inventory-repository.js";

// Más de dos páginas con precios y fechas que contradicen el orden alfabético.
export async function seedCatalogData() {
  requireIsolatedStoreDatabase();
  if (process.env.ACADEMIC_ISOLATION === "true") requireAcademicIsolation();
  else requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
  await seedStoreE2e();
  const branchId="71000000-0000-4000-8000-000000000001";
  const actor={userId:"00000000-0000-4000-8000-000000000099",permissions:["inventory.manage_all"]};
  await prisma.branches.upsert({where:{id:branchId},update:{},create:{id:branchId,code:"CATALOGO_SINTETICO",name:"Z Catálogo sintético",pickup_enabled:true,information_source:"Fixture local de catálogo; sin ubicación ni existencias reales"}});
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const product=await prisma.products.upsert({ where: { sku: `DEMO-CATALOGO-${suffix}` }, update: {}, create: {
      sku: `DEMO-CATALOGO-${suffix}`, name: `CatalogoDemo${suffix}`, category: index % 2 ? "FRAME" : "ACCESSORY",
      unit_price_cents: 1000 + (54 - index) * 100, created_at: new Date(Date.UTC(2026, 9, 1, 0, index)), is_test_data: true,
      created_by: "00000000-0000-4000-8000-000000000099", updated_by: "00000000-0000-4000-8000-000000000099",
      inventory_mode:"TRACKED",
    } });
    if(!await prisma.inventory_stocks.findUnique({where:{branch_id_product_id:{branch_id:branchId,product_id:product.id}}})) await mutateInventory({productId:product.id,branchId,kind:"COUNT",quantity:2,expectedVersion:null,reason:"Conteo exclusivamente sintético del catálogo"},actor,`catalog-fixture:${product.id}`);
  }
}
