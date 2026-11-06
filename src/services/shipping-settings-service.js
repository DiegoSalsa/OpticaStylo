import { prisma } from "../db/prisma.js";
import { requirePermissions } from "../auth/require-permission.js";
import { shippingConfiguration, shippingError } from "../config/shipping.js";
import { shippingProvider } from "../integrations/shipping/chilexpress.js";
import { shippingText, validateDestination, validatedLogistics } from "./shipping-policy.js";
import { validateSaleId } from "../validations/sale-validation.js";

function authorize(actor) { requirePermissions(actor, ["inventory.manage_all", "products.manage"]); }
export async function shippingSettings(actor) {
  authorize(actor);
  const config = shippingConfiguration();
  const [branches, packaging] = await Promise.all([prisma.branches.findMany({ orderBy: { code: "asc" } }), prisma.shipping_packaging.findMany({ orderBy: { code: "asc" } })]);
  return { mode: config.mode, threshold: config.threshold, ordersEnabled: config.ordersEnabled,
    credentials: Object.fromEntries(Object.entries(config.keys).map(([k,v]) => [k, Boolean(v)])),
    branches: branches.map((b) => ({ id: b.id, name: b.name, pickupEnabled: b.pickup_enabled, shippingEnabled: b.shipping_enabled, origin: b.shipping_origin })),
    packaging: packaging.map((p) => ({ ...p, tare_weight_kg: Number(p.tare_weight_kg), height_cm: Number(p.height_cm), width_cm: Number(p.width_cm), length_cm: Number(p.length_cm) })) };
}
export async function updateShippingSettings(actor, input) {
  authorize(actor);
  if (input?.kind === "PRODUCT") {
    const id = validateSaleId(input.id);
    const value = validatedLogistics(input.logistics);
    await prisma.products.update({ where: { id }, data: { shipping_logistics: { ...value, validatedBy: actor.userId, validatedAt: new Date().toISOString() } } });
  } else if (input?.kind === "PACKAGING") {
    const p = input.packaging;
    if (!/^[A-Z0-9_-]{1,40}$/.test(p?.code ?? "") || !Number.isInteger(p.maxUnits) || p.maxUnits < 1 || p.maxUnits > 100) shippingError("SHIPPING_SETTINGS_INVALID", "Código de embalaje o capacidad inválida.", 400);
    for (const k of ["tareWeightKg", "heightCm", "widthCm", "lengthCm"]) if (!Number.isFinite(p[k]) || p[k] < (k === "tareWeightKg" ? 0 : 0.01) || p[k] > (k === "tareWeightKg" ? 100 : 200) || Math.abs(p[k] * 100 - Math.round(p[k] * 100)) > 0.00001) shippingError("SHIPPING_SETTINGS_INVALID", "Peso o dimensiones de embalaje inválidas.", 400);
    const data = { validated: p.validated === true, tare_weight_kg: p.tareWeightKg, height_cm: p.heightCm, width_cm: p.widthCm, length_cm: p.lengthCm, max_units: p.maxUnits, updated_at: new Date() };
    await prisma.shipping_packaging.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
  } else if (input?.kind === "BRANCH") {
    const id = validateSaleId(input.id);
    if (typeof input.enabled !== "boolean") shippingError("SHIPPING_SETTINGS_INVALID", "Debe indicar si el origen está habilitado.", 400);
    if (!input.enabled) await prisma.branches.update({ where: { id }, data: { shipping_enabled: false } });
    else {
      if (input.origin?.validated !== true) shippingError("SHIPPING_LOGISTICS_MISSING", "Confirme la verificación física del origen.", 400);
      const origin = validateDestination(input.origin);
      Object.assign(origin, { name: shippingText(input.origin.name, "Remitente"), email: shippingText(input.origin.email, "Correo", 254), phone: shippingText(input.origin.phone, "Teléfono", 20) });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(origin.email) || !/^\+?\d{8,15}$/.test(origin.phone) || ![1,10000331,2,4,5,7].includes(input.origin.contentType)) shippingError("SHIPPING_SETTINGS_INVALID", "Datos de remitente o contenido declarado inválidos.", 400);
      const provider = shippingProvider();
      const region = (await provider.regions()).find((r) => r.regionId === origin.regionCode);
      const county = region && (await provider.counties(origin.regionCode)).find((c) => c.countyCode === origin.countyCode);
      if (!county) shippingError("SHIPPING_NO_COVERAGE", "Seleccione una cobertura oficial de origen.", 422);
      Object.assign(origin, { countyName: county.countyName }, await provider.address({ ...origin, countyName: county.countyName }));
      await prisma.branches.update({ where: { id }, data: { shipping_enabled: true, shipping_origin: { ...origin, contentType: input.origin.contentType, validated: true, validatedBy: actor.userId, validatedAt: new Date().toISOString() } } });
    }
  } else shippingError("SHIPPING_SETTINGS_INVALID", "Seleccione una configuración válida.", 400);
  return shippingSettings(actor);
}
