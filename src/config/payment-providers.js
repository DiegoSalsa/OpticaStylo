import { AppError } from "../utils/app-error.js";
// Configuración centralizada de payment-providers.

// Verificar required secret para impedir que la operación continúe en un estado inválido
function requiredSecret(value, variableName) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new AppError({
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      message: `Falta configurar ${variableName}.`,
      status: 503,
    });
  }
  return normalized;
}

// Centralizar la lógica de optional público url para mantener consistente el comportamiento de la aplicación
function optionalPublicUrl(value) {
  const normalized = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  if (!normalized) return null;

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    parsed = null;
  }

  if (!parsed || parsed.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw new AppError({
      code: "INVALID_PUBLIC_APP_URL",
      message: "APP_PUBLIC_URL debe ser una URL HTTPS pública y no puede usar localhost.",
      status: 500,
    });
  }
  return normalized;
}

// Centralizar la lógica de pago mode para mantener consistente el comportamiento de la aplicación
function paymentMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "sandbox";
  if (!["sandbox", "production"].includes(normalized)) {
    throw new AppError({
      code: "INVALID_PAYMENT_PROVIDER_MODE",
      message: "MERCADO_PAGO_MODE debe ser sandbox o production.",
      status: 500,
    });
  }
  return normalized;
}

// Consultar get mercado pago configuración y devolver los datos en el formato esperado por la capa llamadora
export function getMercadoPagoConfig(environment = process.env) {
  const mode = paymentMode(environment.MERCADO_PAGO_MODE);
  const productionEnabled = environment.MERCADO_PAGO_PRODUCTION_ENABLED === "true";
  if (mode === "production" && !productionEnabled) {
    throw new AppError({
      code: "PAYMENT_PRODUCTION_LOCKED",
      message: "Los pagos reales permanecen bloqueados hasta completar la prueba de sandbox.",
      status: 503,
    });
  }

  return {
    accessToken: requiredSecret(environment.MERCADO_PAGO_ACCESS_TOKEN, "MERCADO_PAGO_ACCESS_TOKEN"),
    // Checkout Pro ejecuta compras con cuentas y tarjetas de prueba en el
    // checkout principal, que informa live_mode=true aun en esa simulación.
    expectedLiveMode: true,
    mode,
    productionEnabled,
    publicKey: requiredSecret(environment.MERCADO_PAGO_PUBLIC_KEY, "MERCADO_PAGO_PUBLIC_KEY"),
    publicUrl: optionalPublicUrl(environment.APP_PUBLIC_URL),
    webhookSecret: typeof environment.MERCADO_PAGO_WEBHOOK_SECRET === "string"
      ? environment.MERCADO_PAGO_WEBHOOK_SECRET.trim() || null
      : null,
  };
}

// Verificar require mercado pago webhook secret para impedir que la operación continúe en un estado inválido
export function requireMercadoPagoWebhookSecret(config) {
  return requiredSecret(config.webhookSecret, "MERCADO_PAGO_WEBHOOK_SECRET");
}

// Verificar require mercado pago checkout ready para impedir que la operación continúe en un estado inválido
export function requireMercadoPagoCheckoutReady(config) {
  requireMercadoPagoWebhookSecret(config);
  if (!config.publicUrl) {
    throw new AppError({
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      message: "Falta configurar APP_PUBLIC_URL para retornos y webhooks.",
      status: 503,
    });
  }
  return config;
}
