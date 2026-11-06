import assert from "node:assert/strict";
import { prisma } from "../src/db/prisma.js";
import { hashPassword } from "../src/auth/password.js";
import { shippingConfiguration } from "../src/config/shipping.js";
import { changeShipment, issueShipment, syncShipment } from "../src/services/shipping-service.js";
import { requireEvaluationDatabase, evaluation } from "../tests/evaluation-data.js";
import { fixtureRut } from "../tests/rut-fixture.js";
import { actor, syntheticPayment } from "../tests/shipping/helpers.js";
import { shippingDemo, destination } from "../tests/shipping/data.js";

requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
if (!shippingConfiguration().synthetic) throw new Error("Solo demostración sintética aislada.");
const base = process.env.EVALUATION_HTTP_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:(3129|3139)$/);
const buyer = { rut: fixtureRut(9696), firstNames: "Comprador despacho", lastNames: "SINTÉTICO", email: "despachos-demo@example.invalid", phone: "+56911112222", address: "Dirección exclusivamente sintética" };
async function request(path, method = "GET", body, cookie = "") {
  return fetch(`${base}${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function data(response) {
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.data;
}
try {
  const customer = await prisma.customers.create({ data: { rut: buyer.rut, first_names: buyer.firstNames, last_names: buyer.lastNames, email: buyer.email, phone: buyer.phone, address: buyer.address } });
  await prisma.customer_accounts.create({ data: { customer_id: customer.id, email: buyer.email, password_hash: await hashPassword(evaluation.password), email_verified_at: new Date() } });
  const login = await request("/api/store/accounts/login", "POST", { email: buyer.email, password: evaluation.password }); await data(login);
  const accountCookie = login.headers.getSetCookie()[0].split(";")[0];
  for (const [index, productId] of [shippingDemo.products[0], shippingDemo.products[3]].entries()) {
    const response = await request("/api/store/cart", "POST", null, accountCookie); await data(response);
    const cookie = `${accountCookie}; ${response.headers.getSetCookie()[0].split(";")[0]}`;
    await data(await request("/api/store/cart/items", "POST", { items: [{ productId, quantity: 1 }] }, cookie));
    const q = (await data(await request("/api/store/cart/shipping", "POST", { destination }, cookie))).quotes[0];
    await data(await request("/api/store/cart", "PATCH", { buyer, fulfillment: { method: "DELIVERY", quoteId: q.id, notes: "Demostración SINTÉTICA, no entregar al transportista" } }, cookie));
    const order = (await data(await request("/api/store/cart/checkout", "POST", null, cookie))).order;
    await syntheticPayment(order);
    if (index === 0) {
      await changeShipment(order.id, actor, { action: "PREPARE", evidence: "Bulto sintético inspeccionado para demo" });
      await issueShipment(order.id, actor);
      await changeShipment(order.id, actor, { action: "HAND_OVER", evidence: "Comprobante exclusivamente sintético DEMO-1" });
      await syncShipment(order.id);
    }
    console.log(`${index === 0 ? "Despacho normal con OT y seguimiento" : "Despacho gratis pagado, listo para preparar y emitir OT"}: pedido ${order.saleNumber}, ${order.id}, cobro despacho ${order.shippingFeeCents} CLP.`);
  }
  console.log(`Cliente sintético: ${buyer.email}`);
  console.log(`Administrador sintético: ${evaluation.adminEmail}`);
  console.log(`Contraseña exclusivamente local: ${evaluation.password}`);
  console.log("No se enviaron mensajes ni se contactó a Chilexpress o Mercado Pago.");
} finally { await prisma.$disconnect(); }
