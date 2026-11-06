import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { getStoreCart, getStoreOrder } from "./store-service.js";
import { getSale } from "./sale-service.js";
import { requirePermissions } from "../auth/require-permission.js";
import { shippingError } from "../config/shipping.js";
import { shippingProvider } from "../integrations/shipping/chilexpress.js";
import { fingerprint, shippingText, trackingState, validateDestination } from "./shipping-policy.js";
import { assertShippable, handOverShipment, lockShipment, mapShipment, quoteCart, quoteSnapshot, queueShippingEmail, saveShippingQuotes, shipmentForSale, shippingOperation } from "../repositories/shipping-repository.js";
import { validateSaleId } from "../validations/sale-validation.js";

export async function shippingLocations(regionCode) {
  const provider = shippingProvider();
  const regions = await provider.regions();
  if (!Array.isArray(regions)) shippingError("SHIPPING_PROVIDER_UNAVAILABLE", "No se pudo consultar regiones.", 503);
  if (regionCode && !regions.some((r) => r.regionId === regionCode)) shippingError("SHIPPING_ADDRESS_INVALID", "Seleccione una región disponible.", 400);
  const counties = regionCode ? await provider.counties(regionCode) : [];
  if (!Array.isArray(counties)) shippingError("SHIPPING_PROVIDER_UNAVAILABLE", "No se pudo consultar coberturas.", 503);
  return { synthetic: provider.config.synthetic, threshold: provider.config.threshold, regions: regions.map((r) => ({ code: r.regionId, name: r.regionName })), counties: counties.map((r) => ({ code: r.countyCode, name: r.countyName })) };
}

export async function quoteStoreShipping(token, account, input) {
  const cart = await getStoreCart(token, account);
  const destination = validateDestination(input?.destination);
  const provider = shippingProvider();
  const locations = await shippingLocations(destination.regionCode);
  const county = locations.counties.find((r) => r.code === destination.countyCode);
  if (!county) shippingError("SHIPPING_NO_COVERAGE", "El destino no pertenece a las coberturas disponibles.", 422);
  Object.assign(destination, { countyName: county.name, regionName: locations.regions.find((r) => r.code === destination.regionCode).name });
  Object.assign(destination, await provider.address(destination));
  const snapshot = await quoteSnapshot(prisma, await quoteCart(prisma, cart.id), destination);
  const rates = await provider.rates({ originCountyCode: snapshot.origin.countyCode, destinationCountyCode: destination.countyCode,
    package: snapshot.parcel, productType: 3, contentType: Number(snapshot.origin.contentType), declaredWorth: String(snapshot.subtotal - snapshot.discount), deliveryTime: 0 });
  if (!rates.length) shippingError("SHIPPING_NO_COVERAGE", "Chilexpress no devolvió servicios para este origen y destino.", 422);
  return { addressStatus: "VALID", quotes: await saveShippingQuotes(cart.id, snapshot, rates, provider.config) };
}

export async function authorizedShipment(saleId, actor, write = false) {
  requirePermissions(actor, [write ? "sales.update" : "sales.read"]);
  await getSale(validateSaleId(saleId), actor);
  const row = await shipmentForSale(saleId);
  if (!row) shippingError("SHIPMENT_NOT_FOUND", "Este pedido no tiene un despacho registrado.", 404);
  return row;
}
export async function getShipment(saleId, actor) { return mapShipment(await authorizedShipment(saleId, actor), true); }
export async function getCustomerShipment(saleId, token, account) {
  await getStoreOrder(saleId, token, account);
  return mapShipment(await shipmentForSale(saleId));
}
function assertEnvironment(row, provider) {
  if (row.quote.environment !== provider.config.mode) shippingError("SHIPMENT_ENVIRONMENT_MISMATCH", "El despacho pertenece a otro ambiente. No se enviará al proveedor actual.");
}
function issuePayload(row, sale, config) {
  const s = row.quote.snapshot;
  const origin = s.origin;
  const destination = s.destination;
  const buyer = sale.store_carts;
  if (!buyer?.buyer_first_names || !buyer.buyer_phone || !buyer.buyer_email || !origin.contentType) shippingError("SHIPPING_LOGISTICS_MISSING", "Faltan datos del remitente o destinatario.");
  return {
    header: { certificateNumber: 0, customerCardNumber: config.tcc, countyOfOriginCoverageCode: origin.countyCode, labelType: 2, marketplaceRut: config.rut, sellerRut: config.sellerRut },
    details: [{ addresses: [
      { addressId: destination.addressId, countyCoverageCode: destination.countyCode, streetName: destination.street, streetNumber: destination.number, supplement: destination.supplement, addressType: "DEST", deliveryOnCommercialOffice: false, observation: sale.delivery_notes ?? "" },
      { addressId: origin.addressId ?? 0, countyCoverageCode: origin.countyCode, streetName: origin.street, streetNumber: origin.number, supplement: origin.supplement ?? "", addressType: "DEV", deliveryOnCommercialOffice: false, observation: "" },
    ], contacts: [
      { name: origin.name, phoneNumber: origin.phone, mail: origin.email, contactType: "R" },
      { name: `${buyer.buyer_first_names} ${buyer.buyer_last_names}`, phoneNumber: buyer.buyer_phone, mail: buyer.buyer_email, contactType: "D" },
    ], packages: [{ ...s.parcel, serviceDeliveryCode: row.quote.service_code, productCode: "3", deliveryReference: row.reference, groupReference: row.reference,
      declaredValue: String(Number(sale.subtotal_cents) - Number(sale.discount_cents)), declaredContent: String(origin.contentType), receivableAmountInDelivery: 0 }] }],
  };
}

export function decodeShippingLabel(base64) {
  if (typeof base64 !== "string" || base64.length > 15_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) shippingError("SHIPPING_LABEL_UNAVAILABLE", "El proveedor no entregó una etiqueta reconocida.");
  const data = Buffer.from(base64, "base64");
  const mime = data.subarray(0, 4).toString() === "%PDF" ? "application/pdf" : data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : data[0] === 255 && data[1] === 216 ? "image/jpeg" : null;
  if (!mime) shippingError("SHIPPING_LABEL_UNAVAILABLE", "Formato de etiqueta pendiente de validación.");
  return { data, mime };
}
async function storeIssued(saleId, result, actorId, operation) {
  return retryTransaction(prisma, async (client) => {
    const row = await lockShipment(client, saleId);
    if (row.ot && row.ot !== result.ot) shippingError("SHIPMENT_RECONCILIATION_CONFLICT", "Hay una OT diferente registrada; se requiere revisión.");
    if (row.ot) return;
    if (!["ISSUING", "UNCERTAIN"].includes(row.state)) shippingError("SHIPMENT_STATE_INVALID", "El despacho no admite esta respuesta de emisión.");
    // Save the OT even if the optional label format is unsupported. A label
    // parsing error must never cause a second transport order.
    let label;
    try { if (result.label) label = decodeShippingLabel(result.label); } catch { /* Recover via private reprint. */ }
    await client.shipping_shipments.update({ where: { id: row.id }, data: { state: "OT_ISSUED", ot: result.ot, certificate: result.certificate ?? null, issued_service: result.service ?? null,
      ...(label ? { label_data: label.data, label_mime: label.mime } : {}), last_error_code: null } });
    await shippingOperation(client, row.id, actorId, operation, { ot: result.ot, issuedService: result.service ?? null });
    await queueShippingEmail(client, { ...row, ot: result.ot }, "OT_ISSUED");
  });
}

async function reconcileShipment(saleId, actorId, provider) {
  const row = await shipmentForSale(saleId);
  const result = await provider.track({ reference: row.reference, ot: null });
  if (result.reference !== row.reference || !result.ot) shippingError("SHIPPING_RESULT_UNCERTAIN", "La referencia no permite conciliar inequívocamente la OT. Contacte a Chilexpress antes de volver a emitir.");
  await storeIssued(saleId, result, actorId, "OT_RECONCILED");
}

export async function issueShipment(saleId, actor, provider = shippingProvider()) {
  const existing = await authorizedShipment(saleId, actor, true);
  assertEnvironment(existing, provider);
  if (existing.ot) return getShipment(saleId, actor);
  if (["ISSUING", "UNCERTAIN"].includes(existing.state)) {
    await reconcileShipment(saleId, actor.userId, provider);
    return getShipment(saleId, actor);
  }
  if (!provider.config.synthetic && (!provider.config.ordersEnabled || !provider.config.keys.orders || !provider.config.tcc || !/^\d+$/.test(provider.config.rut ?? "") || !/^\d+$/.test(provider.config.sellerRut ?? ""))) shippingError("SHIPPING_ORDERS_NOT_CONFIGURED", "Se requieren claves del ambiente, TCC, RUT empresa y habilitación de emisión.");
  const claim = await retryTransaction(prisma, async (client) => {
    const row = await lockShipment(client, saleId);
    if (row.ot || ["ISSUING", "UNCERTAIN"].includes(row.state)) return null;
    if (row.state !== "PREPARED") shippingError("SHIPMENT_NOT_PREPARED", "Confirme la preparación física antes de emitir la OT.");
    const sale = await assertShippable(client, row);
    const payload = issuePayload(row, sale, provider.config);
    await client.shipping_shipments.update({ where: { id: row.id }, data: { state: "ISSUING" } });
    await shippingOperation(client, row.id, actor.userId, "OT_REQUESTED", { reference: row.reference });
    return { payload, reference: row.reference };
  });
  if (!claim) return getShipment(saleId, actor);
  try {
    const result = await provider.issue(claim.payload);
    if (!result?.ot || (!provider.config.synthetic && !/^\d+$/.test(result.ot))) shippingError("SHIPPING_RESULT_UNCERTAIN", "Respuesta de emisión incompleta.");
    await storeIssued(saleId, result, actor.userId, "OT_ISSUED");
  } catch (error) {
    await retryTransaction(prisma, async (client) => {
      const row = await lockShipment(client, saleId);
      if (!row.ot) {
        await client.shipping_shipments.update({ where: { id: row.id }, data: { state: "UNCERTAIN", last_error_code: "SHIPPING_RESULT_UNCERTAIN" } });
        await shippingOperation(client, row.id, actor.userId, "OT_RESULT_UNCERTAIN", {});
      }
    });
    // No automatic POST retry, including after a process crash. Reconcile by
    // official Tracking reference; absence of a result is not evidence of no OT.
    throw error;
  }
  return getShipment(saleId, actor);
}

export async function changeShipment(saleId, actor, input) {
  await authorizedShipment(saleId, actor, true);
  if (input?.action === "ISSUE") return issueShipment(saleId, actor);
  if (input?.action === "SYNC") return syncShipment(saleId, shippingProvider(), actor.userId);
  if (!["PREPARE", "HAND_OVER"].includes(input?.action)) shippingError("SHIPMENT_ACTION_INVALID", "Acción logística inválida.", 400);
  const evidence = shippingText(input.evidence, "Referencia de preparación o comprobante de recepción", 300);
  await retryTransaction(prisma, async (client) => {
    const row = await lockShipment(client, saleId);
    if (input.action === "PREPARE") {
      if (row.state === "PREPARED") return;
      if (row.state !== "PENDING_PREPARATION") shippingError("SHIPMENT_STATE_INVALID", "El pedido ya pasó la preparación.");
      await assertShippable(client, row);
      await client.shipping_shipments.update({ where: { id: row.id }, data: { state: "PREPARED" } });
      await shippingOperation(client, row.id, actor.userId, "PREPARED", { evidence });
      await queueShippingEmail(client, row, "PREPARED");
    } else {
      if (row.handed_over_at) return;
      if (row.state !== "OT_ISSUED" || !row.ot) shippingError("SHIPMENT_STATE_INVALID", "Se requiere una OT emitida para registrar la entrega al transportista.");
      await handOverShipment(client, row, actor.userId, evidence);
    }
  });
  return getShipment(saleId, actor);
}

export async function syncShipment(saleId, provider = shippingProvider(), actorId = null) {
  const claimed = await retryTransaction(prisma, async (client) => {
    const row = await lockShipment(client, saleId);
    assertEnvironment(row, provider);
    if (!row.ot) shippingError("SHIPMENT_OT_REQUIRED", "Todavía no hay una OT emitida.");
    if (row.next_sync_at && row.next_sync_at > new Date()) return null;
    await client.shipping_shipments.update({ where: { id: row.id }, data: { next_sync_at: new Date(Date.now() + provider.config.trackingIntervalMs) } });
    return row;
  });
  if (!claimed) return mapShipment(await shipmentForSale(saleId), Boolean(actorId));
  try {
    const tracking = await provider.track({ ot: claimed.ot, reference: claimed.reference });
    if (tracking.ot !== claimed.ot) shippingError("SHIPMENT_RECONCILIATION_CONFLICT", "La consulta devolvió otra OT.");
    await retryTransaction(prisma, async (client) => {
      const row = await lockShipment(client, saleId);
      let added = 0;
      for (const e of tracking.events) {
        const hash = fingerprint(e);
        const inserted = await client.shipping_tracking_events.createMany({ skipDuplicates: true, data: [{ shipment_id: row.id, fingerprint: hash, code: String(e.code).slice(0,40), description: String(e.description).slice(0,500),
          occurred_at: e.occurredAt && !Number.isNaN(Date.parse(e.occurredAt)) ? new Date(e.occurredAt) : null, location: e.location == null ? null : String(e.location).slice(0,200), motive: e.motive == null ? null : String(e.motive).slice(0,300) }] });
        added += inserted.count;
      }
      const all = await client.shipping_tracking_events.findMany({ where: { shipment_id: row.id } });
      const state = trackingState(all.map((e) => ({ code: e.code, motive: e.motive, occurredAt: e.occurred_at?.toISOString() })));
      if (["HANDED_OVER", "IN_TRANSIT", "DELIVERED"].includes(state) && !row.handed_over_at) await handOverShipment(client, row, actorId, "Recepción verificada mediante API oficial de seguimiento.");
      // Never restock or refund based on returns/exceptions. No delivery inference from labels.
      const effectiveState = row.state === "DELIVERED" ? "DELIVERED" : state ?? row.state;
      await client.shipping_shipments.update({ where: { id: row.id }, data: { state: effectiveState, last_checked_at: new Date(), last_error_code: null, failure_count: 0, provider_status: String(tracking.description ?? "").slice(0,300) } });
      if (state === "DELIVERED") {
        const sale = await client.sales.findUnique({ where: { id: saleId } });
        if (sale.status !== "DELIVERED") {
          await client.sales.update({ where: { id: saleId }, data: { status: "DELIVERED" } });
          await client.sale_events.create({ data: { sale_id: saleId, event_type: "STATUS_CHANGED", previous_status: sale.status, new_status: "DELIVERED", performed_by: actorId, details: JSON.stringify({ source: "CHILEXPRESS_TRACKING", ot: row.ot }) } });
        }
      }
      if (added) {
        await shippingOperation(client, row.id, actorId, "TRACKING_UPDATED", { added, state: effectiveState });
        if (["DELIVERED", "EXCEPTION"].includes(effectiveState)) await queueShippingEmail(client, row, effectiveState);
      }
    });
  } catch (error) {
    await prisma.shipping_shipments.update({ where: { id: claimed.id }, data: { last_error_code: "SHIPPING_SYNC_FAILED", failure_count: { increment: 1 }, next_sync_at: new Date(Date.now() + Math.min(3600000, provider.config.trackingIntervalMs * 2 ** Math.min(claimed.failure_count + 1, 4))) } });
    throw error;
  }
  return mapShipment(await shipmentForSale(saleId), Boolean(actorId));
}

export async function shipmentLabel(saleId, actor) {
  let row = await authorizedShipment(saleId, actor);
  if (!row.ot) shippingError("SHIPMENT_OT_REQUIRED", "Todavía no hay una OT emitida.");
  const provider = shippingProvider();
  assertEnvironment(row, provider);
  if (row.quote.environment === "synthetic") return { data: Buffer.from(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Etiqueta de prueba</title><style>body{font:20px sans-serif;padding:40px;border:8px dashed #a00}strong{color:#a00}</style><strong>PRUEBA SINTÉTICA · NO VÁLIDA PARA TRANSPORTE</strong><h1>Óptica Stylo</h1><p>OT ${row.ot}</p><p>Referencia ${row.reference}</p><p>Imprimir con Ctrl+P. No entregar a Chilexpress.</p></html>`), mime: "text/html; charset=utf-8" };
  if (!row.label_data) {
    const label = decodeShippingLabel(await provider.label(row.ot));
    row = await prisma.shipping_shipments.update({ where: { id: row.id }, data: { label_data: label.data, label_mime: label.mime } });
  }
  await shippingOperation(prisma, row.id, actor.userId, "LABEL_ACCESSED");
  return { data: row.label_data, mime: row.label_mime };
}
