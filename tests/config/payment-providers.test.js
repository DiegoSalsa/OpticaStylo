import assert from "node:assert/strict";
import test from "node:test";

import {
  getMercadoPagoConfig,
  requireMercadoPagoWebhookSecret,
} from "../../src/config/payment-providers.js";

test("carga credenciales de Mercado Pago sin exponer valores predeterminados", () => {
  const config = getMercadoPagoConfig({
    APP_PUBLIC_URL: "https://tienda.example.com/",
    MERCADO_PAGO_ACCESS_TOKEN: "token-prueba",
    MERCADO_PAGO_PUBLIC_KEY: "public-key-prueba",
    MERCADO_PAGO_WEBHOOK_SECRET: "firma-prueba",
  });

  assert.equal(config.publicUrl, "https://tienda.example.com");
  assert.equal(config.accessToken, "token-prueba");
});

test("permite crear preferencias locales sin dominio público", () => {
  const config = getMercadoPagoConfig({
    MERCADO_PAGO_ACCESS_TOKEN: "token-prueba",
    MERCADO_PAGO_PUBLIC_KEY: "public-key-prueba",
  });

  assert.equal(config.publicUrl, null);
  assert.equal(config.webhookSecret, null);
});

test("rechaza dominios locales para retornos de Mercado Pago", () => {
  assert.throws(() => getMercadoPagoConfig({
    APP_PUBLIC_URL: "http://localhost:3000",
    MERCADO_PAGO_ACCESS_TOKEN: "token-prueba",
    MERCADO_PAGO_PUBLIC_KEY: "public-key-prueba",
  }), (error) => error.code === "INVALID_PUBLIC_APP_URL");
});

test("mantiene cerrado el webhook mientras falta su secreto", () => {
  assert.throws(
    () => requireMercadoPagoWebhookSecret({ webhookSecret: null }),
    (error) => error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED" && error.status === 503,
  );
});
