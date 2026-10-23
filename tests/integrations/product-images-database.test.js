import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("persiste procedencia y resuelve cargas simultáneas sin duplicar imágenes ni eventos", { skip: process.env.PRODUCT_IMAGES_DATABASE_TEST !== "true" }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/stylo_images_romano");
  const { prisma } = await import("../../src/db/prisma.js");
  const { addProductImage } = await import("../../src/services/product-image-service.js");
  const { PERMISSIONS } = await import("../../src/auth/permissions.js");
  const userId = randomUUID(); const productId = randomUUID();
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.write("IHDR", 12); data.writeUInt32BE(1200, 16); data.writeUInt32BE(600, 20);
  const file = new File([data], "prueba-sin-fotografia.png", { type: "image/png" });
  const provenance = {
    identity: { brand: "PRUEBA", model: "TECNICA", color: "NEUTRO" },
    authorization: { status: "AUTHORIZED", commercialUse: true, holder: "Fixture aislado", scope: "Solo prueba automatizada", evidenceUrl: "https://example.invalid/licencia-fixture" },
    verification: { status: "EXACT", colorConfirmed: true, reviewedBy: "Fixture aislado", reviewedAt: "2026-10-01T12:00:00Z", evidenceUrl: "https://example.invalid/fixture" },
    workbookSha256: "a".repeat(64), inventoryRows: [{ sheet: "Fixture", row: 1, originalRow: 1, block: "B-F" }],
    sourceUrl: "https://example.invalid/fixture", sourceImageUrl: "https://example.invalid/fixture.png", view: "FRONT",
  };
  const gateway = {
    uploadPublicProductImage: async ({ publicId }) => ({ assetId: `mock-${productId}`, publicId: `opticastylo/productos/${publicId}`, version: 1, secureUrl: `https://res.cloudinary.com/fixture/image/upload/opticastylo/productos/${publicId}.png`, width: 1200, height: 600, format: "png" }),
    deletePublicProductImage: async () => assert.fail("No debe borrar un recurso compartido por reintentos concurrentes"),
  };
  try {
    await prisma.users.create({ data: { id: userId, email: `${userId}@example.invalid`, password_hash: "fixture-aislado-sin-autenticacion", first_name: "Prueba", last_name: "Fotografías" } });
    await prisma.products.create({ data: { id: productId, sku: `TEST-${productId.toUpperCase()}`, name: "Fixture aislado de procedencia", category: "FRAME", unit_price_cents: 1, is_active: false, is_test_data: true, created_by: userId, updated_by: userId } });
    const actor = { userId, permissions: [PERMISSIONS.PRODUCTS_MANAGE] };
    async function attempt() {
      for (let retry = 0; ; retry += 1) {
        try { return await addProductImage(productId, { alt: "Fixture neutro", file, provenance }, actor, { mediaGateway: gateway }); }
        catch (error) { if (retry >= 2 || error.code !== "PRODUCT_IMAGE_ASSOCIATION_UNCERTAIN") throw error; }
      }
    }
    const results = await Promise.all([attempt(), attempt()]);
    assert.equal(results[0].id, results[1].id);
    const stored = await prisma.product_images.findMany({ where: { product_id: productId } });
    assert.equal(stored.length, 1); assert.equal(stored[0].provenance.authorization.status, "AUTHORIZED");
    assert.equal(stored[0].provenance.identity.color, "NEUTRO"); assert.equal(stored[0].import_key.length, 64);
    assert.equal(await prisma.product_events.count({ where: { product_id: productId, event_type: "IMAGE_ADDED" } }), 1);
  } finally {
    await prisma.product_images.deleteMany({ where: { product_id: productId } });
    await prisma.product_events.deleteMany({ where: { product_id: productId } });
    await prisma.products.deleteMany({ where: { id: productId } });
    await prisma.users.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
