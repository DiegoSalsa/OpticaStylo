import test from "node:test";
import assert from "node:assert/strict";
import { validateImageProvenance } from "../../src/validations/product-image-provenance.js";

const base = {
  identity: { brand: "GUESS", model: "GU50126", color: "5" },
  sourceUrl: "https://selecteyewear.com/products/guess-gu50126",
  sourceImageUrl: "https://selecteyewear.com/cdn/shop/files/GU50126_005_01.jpg",
  view: "CATALOGUE_VIEW",
  workbookSha256: "a".repeat(64),
  inventoryRows: [{ sheet: "Inventario Romano", row: 1, originalRow: 1, block: "H-L" }],
  authorization: {
    status: "USER_PUBLISHED_PENDING_RIGHTS", commercialUse: false,
    holder: "Publicación explícita de Óptica Stylo; titular pendiente",
    evidenceUrl: "https://selecteyewear.com/products/guess-gu50126",
    scope: "Publicación en revisión de derechos.",
  },
  verification: {
    status: "EXACT_CODE_CANDIDATE", colorConfirmed: true,
    reviewedAt: "2026-10-23T12:00:00.000Z", reviewedBy: "Óptica Stylo",
    evidenceUrl: "https://selecteyewear.com/products/guess-gu50126",
  },
};

test("acepta publicación explícita mientras conserva el estado de derechos pendiente", () => {
  const result = validateImageProvenance(base);
  assert.equal(result.authorization.status, "USER_PUBLISHED_PENDING_RIGHTS");
  assert.equal(result.authorization.commercialUse, false);
  assert.equal(result.verification.status, "EXACT_CODE_CANDIDATE");
});

test("rechaza una procedencia sin autorización ni publicación explícita", () => {
  assert.throws(() => validateImageProvenance({ ...base, authorization: { ...base.authorization, status: "UNKNOWN" } }), /autorización comprobada/);
});
