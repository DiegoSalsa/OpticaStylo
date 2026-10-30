import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { requireEvaluationDatabase, evaluation } from "../evaluation-data.js";
import { fixtureRut } from "../rut-fixture.js";

export const ids = { frame: "00000000-0000-4000-8000-000000000013", lens: "00000000-0000-4000-8000-000000000021" };
export const prescription = {
  rightEye: { sphere: -1.25, cylinder: -0.5, axis: 90, addition: null },
  leftEye: { sphere: -2, cylinder: 0, axis: null, addition: 1.25 },
  pupillaryDistance: 62, fulfillmentNotes: "Prueba sintética de recetas; no usar clínicamente.",
};
export const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
export const buyer = { rut: fixtureRut(9301), firstNames: "RecetasPrueba", lastNames: "Sintética", email: "recetas@example.invalid", phone: "+56912345678", address: "Calle Sintética 123" };
export function database() {
  requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);
  return new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
}
export async function request(path, { cookie, body, method = "GET" } = {}) {
  assert.match(process.env.EVALUATION_HTTP_URL, /^http:\/\/127\.0\.0\.1:3119$/);
  const multipart = body instanceof FormData;
  return fetch(`${process.env.EVALUATION_HTTP_URL}${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body && !multipart ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
}
export async function data(response, status = 200) {
  const json = await response.json();
  assert.equal(response.status, status, JSON.stringify(json)); assert.equal(json.success, true);
  return json.data;
}
export async function cart(cookie = "") {
  const response = await request("/api/store/cart", { method: "POST", cookie });
  const created = await data(response, 201);
  return { cart: created, cookie: [cookie, response.headers.getSetCookie()[0].split(";")[0]].filter(Boolean).join("; ") };
}
export async function addItems(cookie) {
  return data(await request("/api/store/cart/items", { cookie, method: "POST", body: { items: [
    { productId: ids.frame, quantity: 1 }, { productId: ids.lens, mountFrameProductId: ids.frame, quantity: 1 },
  ] } }));
}
export async function configure(cookie, customer = buyer) {
  return data(await request("/api/store/cart", { cookie, method: "PATCH", body: { buyer: customer, fulfillment: { method: "PICKUP" }, clinicalPrescriptionId: null } }));
}
export async function upload(cookie, bytes = image, type = "image/png", name = "receta-sintetica.png") {
  const form = new FormData(); form.set("image", new File([bytes], name, { type }));
  return request("/api/store/cart/prescription/image", { cookie, method: "PUT", body: form });
}
export async function login(restricted = false) {
  const response = await request("/api/auth/login", { method: "POST", body: { email: restricted ? evaluation.restrictedEmail : evaluation.adminEmail, password: evaluation.password } });
  await data(response);
  return response.headers.getSetCookie()[0].split(";")[0];
}
