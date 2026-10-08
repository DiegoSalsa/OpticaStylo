import { prisma } from "../src/db/prisma.js";

export const ids = {
  frame: "00000000-0000-4000-8000-000000000011",
  rayban: "00000000-0000-4000-8000-000000000012",
  noVto: "00000000-0000-4000-8000-000000000013",
  lens: "00000000-0000-4000-8000-000000000021",
  otherLens: "00000000-0000-4000-8000-000000000022",
  noRxLens: "00000000-0000-4000-8000-000000000023",
  accessory: "00000000-0000-4000-8000-000000000031",
};
export function requireIsolatedStoreDatabase() {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema");
  if (!/^stylo_e2e_[0-9a-f]{16}$/.test(schema ?? "") || schema !== process.env.STORE_E2E_SCHEMA) {
    throw new Error("Las pruebas requieren un esquema aislado generado por run-store-e2e.mjs.");
  }
}
export async function seedStoreE2e() {
  requireIsolatedStoreDatabase();
  const actorId = "00000000-0000-4000-8000-000000000099";
  await prisma.users.upsert({ where: { id: actorId }, update: {}, create: {
    id: actorId, email: "fixture@example.invalid", password_hash: "fixture-password-never-used-2026",
    first_name: "Fixture", last_name: "Prueba",
  } });
  for (const [id, sku, name, category, price, required] of [
    [ids.frame, "HD0896-001", "Harley-Davidson HD0896", "FRAME", 50000, false],
    [ids.rayban, "RB2140-901-50", "Ray-Ban RB2140", "FRAME", 45000, false],
    [ids.noVto, "SIN-VTO", "Marco sin VTO", "FRAME", 30000, false],
    [ids.lens, "CRISTAL-TEST", "Cristal monofocal de prueba", "PRESCRIPTION_LENS", 20000, true],
    [ids.otherLens, "CRISTAL-AZUL-TEST", "Cristal filtro azul de prueba", "PRESCRIPTION_LENS", 25000, true],
    [ids.noRxLens, "CRISTAL-SIN-RX-TEST", "Cristal sin graduación", "PRESCRIPTION_LENS", 10000, false],
    [ids.accessory, "ESTUCHE-TEST", "Estuche de prueba", "ACCESSORY", 5000, false],
  ]) await prisma.products.upsert({ where: { id }, update: {}, create: {
    id, sku, name, category, unit_price_cents: price, requires_prescription: required, is_test_data: true,
    created_by: actorId, updated_by: actorId,
  } });
}
if (process.argv[1]?.endsWith("seed-store-e2e.mjs")) {
  try { await seedStoreE2e(); } finally { await prisma.$disconnect(); }
}
