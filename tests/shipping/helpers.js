import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { evaluation, requireEvaluationDatabase } from "../evaluation-data.js";
import { inventoryDemo } from "../inventory/data.js";
import { buyer } from "../prescriptions/helpers.js";
import { logistics, destination } from "./data.js";
import { mutateInventory } from "../../src/repositories/inventory-repository.js";
import { reconcileMercadoPagoPayment } from "../../src/repositories/payment-attempt-repository.js";

export const branch = inventoryDemo.branches[0];
export const actor = { userId: evaluation.adminId, permissions: ["sales.read", "sales.update", "inventory.manage_all"] };
export function isolated() { requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA); }
export async function http(path, { cookie, method = "GET", body } = {}) {
  assert.match(process.env.EVALUATION_HTTP_URL, /^http:\/\/127\.0\.0\.1:3119$/);
  return fetch(`${process.env.EVALUATION_HTTP_URL}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
export async function value(r, status = 200) { const json = await r.json(); assert.equal(r.status, status, JSON.stringify(json)); assert.equal(json.success, true); return json.data; }
export async function employee(email = evaluation.adminEmail) {
  const r = await http("/api/auth/login", { method: "POST", body: { email, password: evaluation.password } }); await value(r);
  return r.headers.getSetCookie()[0].split(";")[0];
}
export async function product(price = 79990, stocks = [5,0,0], custom = logistics) {
  isolated(); const id = randomUUID();
  await prisma.products.create({ data: { id, sku: `SHIP-${id}`.toUpperCase(), name: `Despacho sintético ${id}`, category: "FRAME", inventory_mode: "TRACKED", unit_price_cents: price,
    shipping_logistics: custom ?? {}, is_test_data: true, created_by: evaluation.adminId, updated_by: evaluation.adminId } });
  for (const [index, quantity] of stocks.entries()) await mutateInventory({ productId: id, branchId: inventoryDemo.branches[index], kind: "COUNT", quantity, expectedVersion: null, reason: "Conteo de integración sintético" }, actor, `ship-test:${id}:${index}`);
  return id;
}
export async function newCart(productId, extraItems = []) {
  const r = await http("/api/store/cart", { method: "POST" }); const cart = await value(r,201); const cookie = r.headers.getSetCookie()[0].split(";")[0];
  await value(await http("/api/store/cart/items", { cookie, method: "POST", body: { items: [{ productId, quantity: 1 }, ...extraItems] } }));
  return { cart, cookie, productId };
}
export async function quote(c, d = destination) { return http("/api/store/cart/shipping", { cookie: c.cookie, method: "POST", body: { destination: d } }); }
export async function configure(c, q) { return http("/api/store/cart", { cookie: c.cookie, method: "PATCH", body: { buyer, fulfillment: { method: "DELIVERY", quoteId: q.id } } }); }
export async function order({ price = 79990, id, stocks, method = "DELIVERY" } = {}) {
  const c = await newCart(id ?? await product(price, stocks));
  let q;
  if (method === "DELIVERY") { q = (await value(await quote(c))).quotes[0]; await value(await configure(c,q)); }
  else await value(await http("/api/store/cart", { cookie: c.cookie, method: "PATCH", body: { buyer, fulfillment: { method: "PICKUP", branchId: branch } } }));
  const r = await http("/api/store/cart/checkout", { cookie: c.cookie, method: "POST" });
  const result = await value(r,201);
  return { ...c, q, sale: result.order, cookie: `${c.cookie}; ${r.headers.getSetCookie()[0].split(";")[0]}` };
}
export async function syntheticPayment(sale, status = "approved", attempt = null) {
  isolated();
  const a = attempt ?? await prisma.payment_attempts.create({ data: { sale_id: sale.id, provider: "MERCADO_PAGO", amount_cents: sale.totalCents, expires_at: new Date(Date.now()+1800000), external_preference_id: `TEST-${randomUUID()}`, status: "PENDING", checkout_url: "https://example.invalid/synthetic" } });
  const payment = { externalReference: a.id, transactionAmount: sale.totalCents, currency: "CLP", liveMode: false, externalPreferenceId: a.external_preference_id, externalPaymentId: `SYNTHETIC-${a.id}`, statusDetail: "synthetic", status };
  const result = await reconcileMercadoPagoPayment({ eventType: "payment.updated", dataId: payment.externalPaymentId, payload: { synthetic: true }, requestId: randomUUID() }, payment, { expectedLiveMode: false });
  return { result, attempt: a };
}
export const stock = (productId, branchId = branch) => prisma.inventory_stocks.findUniqueOrThrow({ where: { branch_id_product_id: { branch_id: branchId, product_id: productId } } });
