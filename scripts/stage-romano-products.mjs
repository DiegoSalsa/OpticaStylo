import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { loadProjectEnvironment } from "./load-environment.mjs";
import { createProduct, updateProduct } from "../src/services/product-service.js";
import { prisma } from "../src/db/prisma.js";
import { productImageActor } from "./product-image-actor.mjs";

loadProjectEnvironment();
const { values } = parseArgs({ options: {
  inventory: { type: "string" }, actor: { type: "string" }, apply: { type: "boolean", default: false },
  output: { type: "string", default: "tmp/romano-images/staged-products.json" },
} });
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || !/^\/stylo_images_[a-z0-9_]+$/.test(url.pathname)) throw new Error("La preparación se permite solo en PostgreSQL local dedicado stylo_images_*.");
if (!values.inventory || !values.actor) throw new Error("Indicar --inventory y --actor.");
try {
  const actor = await productImageActor(values.actor);
  const inventory = JSON.parse(await readFile(values.inventory, "utf8"));
  const results = [];
  for (const variant of inventory.variants) {
    const prices = [...new Set(variant.rows.map((row) => row.confirmedPriceClp).filter((price) => price != null))];
    const result = { inventoryKey: variant.key, branch: "GALERIA_ROMANO", rows: variant.rows, stockAudited: false };
    if (prices.length !== 1 || !variant.color) {
      results.push({ ...result, status: !variant.color ? "MISSING_COLOR" : "MISSING_OR_CONFLICTING_PRICE" }); continue;
    }
    const input = { category: "FRAME", name: `${variant.brand} ${variant.model} ${variant.color}`, sku: `ROM-${variant.id.toUpperCase()}`, unitPriceCents: prices[0], requiresPrescription: false };
    let product = await prisma.products.findUnique({ where: { sku: input.sku } });
    if (product && (product.name !== input.name || Number(product.unit_price_cents) !== input.unitPriceCents || product.category !== "FRAME")) throw new Error("Un SKU aislado existente tiene datos distintos; revisar sin sobrescribirlo.");
    if (!values.apply) { results.push({ ...result, proposedProduct: input, status: product ? "EXISTS" : "READY_DRY_RUN" }); continue; }
    if (!product) product = await createProduct(input, actor);
    // Los servicios existentes conservan validaciones, permisos e historial. No se crea stock.
    await updateProduct(product.id, { ...input, isActive: false }, actor);
    results.push({ ...result, status: "STAGED_INACTIVE", productId: product.id, productSku: input.sku, productName: input.name });
  }
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, `${JSON.stringify({ database: url.pathname.slice(1), dryRun: !values.apply, workbookSha256: inventory.workbookSha256, results }, null, 2)}\n`);
  console.log(JSON.stringify({ total: results.length, staged: results.filter((row) => row.status === "STAGED_INACTIVE").length, pending: results.filter((row) => /MISSING/.test(row.status)).length, output: values.output }));
} finally { await prisma.$disconnect(); }
