import { loadProjectEnvironment } from "./load-environment.mjs";

loadProjectEnvironment();

const {
  getMercadoPagoConfig,
  requireMercadoPagoCheckoutReady,
} = await import("../src/config/payment-providers.js");
const { getTransactionalEmailDiagnostic } = await import(
  "../src/config/transactional-email.js"
);

const checks = [];
function check(name, passed, detail) {
  checks.push({ detail, name, passed });
}

let config;
try {
  config = getMercadoPagoConfig();
  check("Modo de pagos", config.mode === "sandbox", config.mode);
  check("Bloqueo de produccion", !config.productionEnabled, "activo");
} catch (error) {
  check("Configuracion base", false, error.message);
}

if (config) {
  try {
    requireMercadoPagoCheckoutReady(config);
    check("Configuracion de checkout", true, "completa");
  } catch (error) {
    check("Configuracion de checkout", false, error.message);
  }
}

if (config) {
  try {
    const response = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({}));
    check(
      "Credencial de Mercado Pago",
      response.ok && Boolean(payload.id),
      response.ok ? `valida para sitio ${payload.site_id ?? "desconocido"}` : `HTTP ${response.status}`,
    );
  } catch (error) {
    check("Credencial de Mercado Pago", false, error.message);
  }
}

const emailDiagnostic = getTransactionalEmailDiagnostic();
check(
  "Correo transaccional",
  emailDiagnostic.ready,
  emailDiagnostic.ready
    ? `modo ${emailDiagnostic.mode}; cron ${emailDiagnostic.workerConfigured ? "configurado" : "inactivo"}`
    : emailDiagnostic.code,
);

for (const result of checks) {
  console.log(`${result.passed ? "OK" : "FALLO"} - ${result.name}: ${result.detail}`);
}
if (checks.some((result) => !result.passed)) process.exitCode = 1;
