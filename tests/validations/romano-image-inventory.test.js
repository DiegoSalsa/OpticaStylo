import assert from "node:assert/strict";
import test from "node:test";
import { inventoryKey, normalizeRomanoRows } from "../../src/integrations/inventory/romano-image-inventory.js";
import { cloudinaryProductLoader, isCloudinaryProductUrl } from "../../src/utils/cloudinary-product-image.js";

test("deduplica por marca modelo y color sin convertir repeticiones en existencias", () => {
  const rows = [ ["Fila Excel", "Bloque", "Marca en Excel", "Código / modelo"],
    [7, "B-F", "A.FALCONI", "FXAF-2251", "C1", null, null, null, null, 75000],
    [8, "H-L", "ANGELO FALCONI", "FXAF2251", "C1", null, null, null, null, 75000],
    [9, "B-F", "THURSDAY", "ST004", "C1"],
    [10, "B-F", "20 UNIDADES", "CUBRELENTES", "N1", null, null, null, null, null, null, "LOTE / REVISAR"],
  ];
  const result = normalizeRomanoRows(rows);
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].rows.length, 2);
  assert.equal(result.summary.stockAudited, false);
  assert.equal(result.variants[1].rows[0].confirmedPriceClp, null);
  assert.equal(result.excluded.length, 1);
  assert.ok(!JSON.stringify(result).includes('"quantity"'));
});
test("aplica solamente equivalencias confirmadas sin adivinar códigos ni marcas", () => {
  assert.equal(inventoryKey({ brand: "GATTI", model: "G6017AX", color: "C1" }), "GATTIZONI|G6017AX|C1");
  assert.equal(inventoryKey({ brand: "LAVANETTE", model: "LT1015", color: "O700" }), "LAVANETTE|LT1015|O700");
});
test("entrega imágenes responsivas sin recortes desde Cloudinary y rechaza fuentes locales", () => {
  const url = "https://res.cloudinary.com/stylo/image/upload/v1/opticastylo/productos/montura.jpg";
  assert.equal(isCloudinaryProductUrl(url), true);
  assert.match(cloudinaryProductLoader({ src: url, width: 640 }), /c_limit,w_640,f_auto,q_auto\/v1/);
  for (const invalid of ["/images/products/uno.jpg", "https://other.test/uno.jpg", "https://res.cloudinary.com.evil.test/stylo/image/upload/uno.jpg", "https://res.cloudinary.com/stylo/image/upload/opticastylo/recetas/uno.jpg"]) assert.equal(isCloudinaryProductUrl(invalid), false);
});
