import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { importProductImages } from "../../src/services/product-image-import-service.js";
import { PERMISSIONS } from "../../src/auth/permissions.js";

const actor = { userId: "00000000-0000-4000-8000-000000000001", permissions: [PERMISSIONS.PRODUCTS_MANAGE] };
const identity = { brand: "ATLANTIS", model: "ANS040", color: "C3" };
const key = "ATLANTIS|ANS040|C3";
const hash = "a".repeat(64);
const product = { id: "00000000-0000-4000-8000-000000000002", sku: "ROM-ANS040-C3", name: "Atlantis ANS040 C3", category: "FRAME" };
const rows = [{ sheet: "Inventario Romano", row: 8, originalRow: 7, block: "B-F" }];
const inventory = { workbookSha256: hash, variants: [{ id: "uno", key, ...identity, rows }] };
function photo() {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.write("IHDR", 12); data.writeUInt32BE(1200, 16); data.writeUInt32BE(600, 20);
  return data;
}
const candidate = {
  id: "c1", inventoryKey: key, identity, alt: "Atlantis ANS040 C3, vista frontal", view: "FRONT", galleryOrder: 0,
  sourceUrl: "https://manufacturer.example.test/ans040-c3", sourceImageUrl: "https://manufacturer.example.test/ans040-c3.png",
  sha256: createHash("sha256").update(photo()).digest("hex"),
  authorization: { status: "AUTHORIZED", commercialUse: true, holder: "Fabricante de prueba", scope: "Catálogo de Óptica Stylo", evidenceUrl: "https://manufacturer.example.test/licencia" },
  verification: { status: "EXACT", colorConfirmed: true, reviewedAt: "2026-10-01T12:00:00Z", reviewedBy: "Responsable de catálogo", evidenceUrl: "https://manufacturer.example.test/ans040-c3" },
  mapping: { inventoryKey: key, productId: product.id, productSku: product.sku, productName: product.name, status: "VERIFIED" },
};
const manifest = { workbookSha256: hash, allowedImageHosts: ["manufacturer.example.test"], candidates: [candidate] };
const deps = {
  findProduct: async () => product,
  download: async () => ({ data: photo(), mediaType: "image/png" }),
  wait: async () => {},
  addImage: async () => assert.fail("La simulación no puede subir imágenes"),
};

test("simula la validación completa sin subir ni persistir", async () => {
  const result = await importProductImages({ manifest, inventory, actor }, deps);
  assert.equal(result.results[0].status, "READY_DRY_RUN");
});
test("rechaza un archivo maestro distinto", async () => {
  await assert.rejects(() => importProductImages({ manifest: { ...manifest, workbookSha256: "b".repeat(64) }, inventory, actor }, deps));
});
test("bloquea color distinto y autorización desconocida antes de descargar", async () => {
  const result = await importProductImages({ manifest: { ...manifest, candidates: [
    { ...candidate, identity: { ...identity, color: "C1" } },
    { ...candidate, authorization: { status: "UNKNOWN" } },
    { ...candidate, mapping: null },
  ] }, inventory, actor }, { ...deps, download: async () => assert.fail("No debe descargar candidatos pendientes") });
  assert.deepEqual(result.results.map((item) => item.status), ["TECHNICAL_ERROR", "PENDING_AUTHORIZATION", "PENDING_PRODUCT_MAPPING"]);
});
test("detecta sustitución del producto, hash alterado y resolución insuficiente", async () => {
  for (const overrides of [
    { findProduct: async () => ({ ...product, sku: "OTRO-COLOR" }) },
    { download: async () => { const data = photo(); data[8] = 1; return { data, mediaType: "image/png" }; } },
    { download: async () => { const data = photo(); data.writeUInt32BE(100, 16); return { data, mediaType: "image/png" }; } },
  ]) {
    const result = await importProductImages({ manifest, inventory, actor }, { ...deps, ...overrides });
    assert.equal(result.results[0].status, "TECHNICAL_ERROR");
  }
});
test("registra antes de subir, reintenta la red y distingue asociaciones previas", async () => {
  const events = []; let calls = 0;
  const result = await importProductImages({ manifest, inventory, actor, dryRun: false }, {
    ...deps, appendEvent: async (event) => events.push(event),
    addImage: async (_id, input) => {
      assert.equal(events[0].status, "STARTED");
      assert.equal(input.provenance.identity.color, "C3");
      if (++calls < 2) throw Object.assign(new Error("Red"), { code: "MEDIA_STORAGE_UNAVAILABLE" });
      return { id: "image1", assetId: "asset1", status: "ACTIVE", duplicate: true };
    },
  });
  assert.equal(result.results[0].status, "ALREADY_ASSOCIATED"); assert.equal(calls, 2);
});
test("no declara éxito si la asociación falla y conserva el identificador recuperable", async () => {
  const result = await importProductImages({ manifest, inventory, actor, dryRun: false }, {
    ...deps, addImage: async () => { throw Object.assign(new Error("token secreto"), { code: "PRODUCT_IMAGE_ASSOCIATION_UNCERTAIN" }); },
  });
  assert.equal(result.results[0].status, "TECHNICAL_ERROR");
  assert.equal(result.results[0].reconciliationRequired, true);
  assert.match(result.results[0].publicId, /^opticastylo\/productos\/romano-/);
  assert.ok(!JSON.stringify(result).includes("token secreto"));
});
test("respeta permisos y límites de lote", async () => {
  await assert.rejects(() => importProductImages({ manifest, inventory, actor: { permissions: [] } }, deps));
  const result = await importProductImages({ manifest, inventory, actor, offset: 1 }, deps);
  assert.equal(result.results.length, 0);
});

test("respeta Retry-After y distingue una fotografía inexistente", async () => {
  const waits = []; let calls = 0;
  const result = await importProductImages({ manifest, inventory, actor }, {
    ...deps, wait: async (ms) => waits.push(ms),
    download: async () => {
      if (++calls === 1) throw Object.assign(new Error("Límite"), { code: "SOURCE_RATE_LIMITED", retryAfterMs: 2000 });
      throw Object.assign(new Error("No existe"), { code: "SOURCE_IMAGE_NOT_FOUND" });
    },
  });
  assert.equal(calls, 2); assert.equal(waits[0], 2000);
  assert.equal(result.results[0].status, "IMAGE_NOT_FOUND");
});

test("conserva el orden de vistas del mismo producto y no divide su galería entre lotes", async () => {
  const calls = [];
  const twoViews = { ...manifest, candidates: [candidate, { ...candidate, id: "c2", galleryOrder: 1, view: "SIDE" }] };
  await assert.rejects(() => importProductImages({ manifest: twoViews, inventory, actor, batchSize: 1 }, deps));
  await assert.rejects(() => importProductImages({ manifest: twoViews, inventory, actor, offset: 1 }, deps));
  const result = await importProductImages({ manifest: twoViews, inventory, actor, dryRun: false, concurrency: 2 }, {
    ...deps, addImage: async (_id, input) => { calls.push(input.provenance.view); return { id: input.provenance.view, status: "ACTIVE" }; },
  });
  assert.deepEqual(calls, ["FRONT", "SIDE"]); assert.equal(result.results.length, 2);
});

test("impide asociar dos variantes al mismo producto", async () => {
  await assert.rejects(() => importProductImages({ manifest: { ...manifest, candidates: [candidate, { ...candidate, id: "c2", inventoryKey: "ATLANTIS|ANS040|C1", galleryOrder: 1 }] }, inventory, actor }, deps), /variantes diferentes/);
});
