import { AppError } from "../utils/app-error.js";

export function shippingError(code, message, status = 409) {
  throw new AppError({ code, message, status });
}

// A production Next build is also used by the isolated demonstration. The
// simulator additionally requires a loopback database and a dedicated test schema.
export function shippingConfiguration(env = process.env) {
  const mode = env.CHILEXPRESS_MODE || "disabled";
  if (!["disabled", "synthetic", "test", "production"].includes(mode)) shippingError("SHIPPING_CONFIGURATION_INVALID", "Ambiente logístico inválido.");
  if (mode === "synthetic") {
    let db;
    try { db = new URL(env.DATABASE_URL); } catch { /* Deny below. */ }
    if (env.CHILEXPRESS_SYNTHETIC_ALLOWED !== "true" || env.DEPLOYMENT_ENVIRONMENT !== "university"
      || env.VERCEL_ENV || !db || !["127.0.0.1", "localhost"].includes(db.hostname)
      || db.username !== "stylo_test" || db.pathname !== "/opticastylo_evaluation"
      || !/^stylo_e2e_[a-f0-9]{16}$/.test(db.searchParams.get("schema") ?? "")
      || db.searchParams.get("schema") !== env.STORE_E2E_SCHEMA || env.EMAIL_MODE !== "disabled") {
      shippingError("SYNTHETIC_SHIPPING_FORBIDDEN", "El simulador requiere un entorno local aislado explícitamente habilitado.");
    }
  }
  if (mode === "production" && (env.CHILEXPRESS_PRODUCTION_ENABLED !== "true" || env.CHILEXPRESS_CERTIFIED !== "true")) {
    shippingError("SHIPPING_PRODUCTION_LOCKED", "La integración productiva requiere habilitación y validación oficial.");
  }
  let productionHost;
  if (mode === "production") {
    try {
      const url = new URL(env.CHILEXPRESS_PRODUCTION_BASE_URL);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".wschilexpress.com") || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error();
      productionHost = url.origin;
    } catch { shippingError("SHIPPING_CONFIGURATION_INVALID", "Configure la URL productiva oficial confirmada durante la habilitación comercial."); }
  }
  const prefix = mode === "production" ? "CHILEXPRESS_PRODUCTION_" : "CHILEXPRESS_TEST_";
  const threshold = Number(env.SHIPPING_FREE_THRESHOLD_CLP ?? 100000);
  if (!Number.isSafeInteger(threshold) || threshold < 0) shippingError("SHIPPING_CONFIGURATION_INVALID", "Umbral de despacho inválido.");
  return {
    mode, synthetic: mode === "synthetic", threshold,
    host: mode === "production" ? productionHost : "https://testservices.wschilexpress.com",
    keys: { coverage: env[`${prefix}COVERAGE_KEY`], rating: env[`${prefix}RATING_KEY`], orders: env[`${prefix}ORDERS_KEY`] },
    tcc: env[`${prefix}TCC`], rut: env[`${prefix}RUT`], sellerRut: env[`${prefix}SELLER_RUT`],
    ordersEnabled: env.CHILEXPRESS_ORDERS_ENABLED === "true",
    quoteTtlMs: 10 * 60_000, trackingIntervalMs: 5 * 60_000,
  };
}

// Initial policy, pending confirmation with Óptica Stylo: merchandise AFTER
// commercial discounts, BEFORE shipping. Amounts named *_cents are CLP in this app.
export function shippingCharge(subtotal, discount, providerCost, threshold = 100000) {
  for (const n of [subtotal, discount, providerCost, threshold]) if (!Number.isSafeInteger(n) || n < 0) shippingError("INVALID_SHIPPING_AMOUNT", "Importe logístico inválido.", 400);
  if (discount > subtotal) shippingError("INVALID_SHIPPING_AMOUNT", "Descuento inválido.", 400);
  return subtotal - discount > threshold ? 0 : providerCost;
}
