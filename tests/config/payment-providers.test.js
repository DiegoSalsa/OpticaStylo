import assert from "node:assert/strict";
import test from "node:test";

import {
  getMercadoPagoConfig,
  requireMercadoPagoCheckoutReady,
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

test("mantiene bloqueado el checkout sin dominio público ni secreto", () => {
  const config = getMercadoPagoConfig({
    MERCADO_PAGO_ACCESS_TOKEN: "token-prueba",
    MERCADO_PAGO_PUBLIC_KEY: "public-key-prueba",
  });

  assert.throws(
    () => requireMercadoPagoCheckoutReady(config),
    (error) => error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED" && error.status === 503,
  );
});

test("exige una habilitación deliberada antes de activar producción", () => {
  assert.throws(() => getMercadoPagoConfig({
    MERCADO_PAGO_ACCESS_TOKEN: "token",
    MERCADO_PAGO_MODE: "production",
    MERCADO_PAGO_PUBLIC_KEY: "public-key",
  }), (error) => error.code === "PAYMENT_PRODUCTION_LOCKED" && error.status === 503);
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
