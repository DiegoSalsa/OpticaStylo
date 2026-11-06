import { createHash } from "node:crypto";
import { shippingError } from "../config/shipping.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
// JSONB may reorder keys; fingerprints must survive a database round trip.
export const fingerprint = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function shippingText(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f<>]/.test(value)) shippingError("SHIPPING_ADDRESS_INCOMPLETE", `${label}: dato obligatorio o inválido.`, 400);
  return value.trim().replace(/\s+/g, " ");
}
export function validateDestination(value) {
  const d = value ?? {};
  const result = { regionCode: shippingText(d.regionCode, "Región", 30), countyCode: shippingText(d.countyCode, "Comuna", 30), street: shippingText(d.street, "Calle"), number: shippingText(d.number, "Numeración", 10), supplement: d.supplement ? shippingText(d.supplement, "Departamento", 80) : "" };
  if (!/^\d{1,10}$/.test(result.number)) shippingError("SHIPPING_ADDRESS_INVALID", "La numeración debe ser numérica.", 400);
  return result;
}
export function validatedLogistics(value) {
  if (value?.validated !== true || !/^[A-Z0-9_-]{1,40}$/.test(value.packagingCode ?? "")) shippingError("SHIPPING_LOGISTICS_MISSING", "Falta validar el peso, dimensiones y embalaje de un producto.");
  for (const k of ["weightKg", "heightCm", "widthCm", "lengthCm"]) if (!Number.isFinite(value[k]) || value[k] <= 0 || value[k] > (k === "weightKg" ? 100 : 200) || Math.abs(value[k] * 100 - Math.round(value[k] * 100)) > 0.00001) shippingError("SHIPPING_LOGISTICS_MISSING", "Peso y dimensiones requieren valores positivos con hasta dos decimales.");
  return { validated: true, packagingCode: value.packagingCode, weightKg: value.weightKg, heightCm: value.heightCm, widthCm: value.widthCm, lengthCm: value.lengthCm };
}
// A single approved packing profile per order. No silent splitting or physical
// transfers. Conservative stacked fit check; a packing operator validates it again.
export function packItems(items, profile) {
  const logistics = items.map((i) => ({ ...validatedLogistics(i.product.shipping_logistics), quantity: i.quantity }));
  if (!profile?.validated || logistics.some((i) => i.packagingCode !== profile.code) || items.reduce((s, i) => s + i.quantity, 0) > profile.max_units) shippingError("SHIPPING_PACKAGING_INCOMPATIBLE", "Los artículos requieren un embalaje conjunto validado; no se dividirá el envío automáticamente.");
  if (logistics.some((i) => i.widthCm > Number(profile.width_cm) || i.lengthCm > Number(profile.length_cm)) || logistics.reduce((s, i) => s + i.heightCm * i.quantity, 0) > Number(profile.height_cm)) shippingError("SHIPPING_PACKAGING_INCOMPATIBLE", "Los artículos no caben juntos en el embalaje validado.");
  const weight = Math.ceil((logistics.reduce((s, i) => s + i.weightKg * i.quantity, 0) + Number(profile.tare_weight_kg)) * 100 - 1e-8) / 100;
  if (weight > 100) shippingError("SHIPPING_PACKAGING_INCOMPATIBLE", "El bulto excede el peso permitido.");
  return { weight: String(weight), height: String(profile.height_cm), width: String(profile.width_cm), length: String(profile.length_cm) };
}

export function trackingState(events) {
  // Only codes evidenced by the official Tracking response example are mapped.
  // Unknown exceptions retain their original description, without guessing delivery.
  const last = [...events].filter((e) => e.occurredAt && !Number.isNaN(Date.parse(e.occurredAt))).sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  if (!last) return null;
  if (last.motive) return "EXCEPTION";
  return ({ "14": "DELIVERED", "13": "IN_TRANSIT", "11": "IN_TRANSIT", "4": "HANDED_OVER" })[last.code] ?? "EXCEPTION";
}
