import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("el POS no crea Checkout Pro mientras Mercado Pago presencial no está configurado", async () => {
  const [route, experience] = await Promise.all([
    source("app/api/sales/[saleId]/checkout/mercado-pago/route.js"),
    source("app/app/ventas/pos-experience.js"),
  ]);

  assert.match(route, /MERCADO_PAGO_PRESENCIAL_NOT_CONFIGURED/);
  assert.doesNotMatch(route, /createMercadoPagoCheckout/);
  assert.match(experience, /Pendiente de configuración comercial/);
  assert.doesNotMatch(experience, /Generar checkout seguro/);
  assert.doesNotMatch(experience, /checkout\/mercado-pago/);
});
