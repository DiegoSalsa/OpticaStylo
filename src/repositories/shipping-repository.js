import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { shippingCharge, shippingConfiguration, shippingError } from "../config/shipping.js";
import { packItems, fingerprint, validatedLogistics } from "../services/shipping-policy.js";
import { settleSaleInventory } from "./inventory-repository.js";

const cartProduct = "products_store_cart_items_product_idToproducts";
const quoteInclude = { store_cart_items: { include: { [cartProduct]: true }, orderBy: { product_id: "asc" } } };
export async function quoteCart(client, cartId) {
  const cart = await client.store_carts.findUnique({ where: { id: cartId }, include: quoteInclude });
  if (!cart || cart.status !== "ACTIVE" || cart.expires_at <= new Date() || !cart.store_cart_items.length) shippingError("CART_NOT_ACTIVE", "El carrito no está disponible para cotizar.");
  return cart;
}

export async function quoteSnapshot(client, cart, destination, branchId = null) {
  const products = cart.store_cart_items.map((i) => ({ quantity: i.quantity, product: i[cartProduct] }));
  if (products.some((i) => !i.product.is_active || i.product.inventory_mode === "UNCONFIGURED")) shippingError("SHIPPING_LOGISTICS_MISSING", "Falta configurar la disponibilidad de un producto.");
  const first = validatedLogistics(products[0].product.shipping_logistics);
  const packaging = await client.shipping_packaging.findUnique({ where: { code: first.packagingCode } });
  const parcel = packItems(products, packaging);
  const branches = await client.branches.findMany({ where: { is_active: true, shipping_enabled: true, ...(branchId ? { id: branchId } : {}) }, orderBy: { code: "asc" } });
  if (!branches.length) shippingError("SHIPPING_ORIGIN_UNAVAILABLE", "No hay una sucursal habilitada como origen logístico.");
  for (const branch of branches) {
    const origin = branch.shipping_origin;
    if (!origin?.validated || !origin.countyCode || !origin.street || !origin.number || !origin.name || !origin.email || !origin.phone || ![1,10000331,2,4,5,7].includes(origin.contentType)) continue;
    const stocks = await client.inventory_stocks.findMany({ where: { branch_id: branch.id, product_id: { in: products.map((i) => i.product.id) } } });
    if (!products.every((i) => i.product.inventory_mode === "ON_DEMAND" || stocks.some((s) => s.product_id === i.product.id && s.on_hand - s.reserved >= i.quantity))) continue;
    return {
      cartId: cart.id, branchId: branch.id, branchName: branch.name, origin, destination, parcel,
      packagingCode: packaging.code,
      subtotal: products.reduce((s, i) => s + Number(i.product.unit_price_cents) * i.quantity, 0), discount: 0,
      // No online commercial discount exists in phases 1–5. Never accept one from the browser.
      items: products.map((i) => ({ id: i.product.id, quantity: i.quantity, price: String(i.product.unit_price_cents), logistics: i.product.shipping_logistics })),
    };
  }
  shippingError("SHIPPING_SINGLE_ORIGIN_REQUIRED", "Ningún origen habilitado puede preparar todos los artículos juntos. No se dividirá el pedido entre sucursales.");
}

export async function saveShippingQuotes(cartId, snapshot, services, config, now = new Date()) {
  return retryTransaction(prisma, async (client) => {
    await client.$queryRaw`SELECT id FROM store_carts WHERE id = ${cartId}::uuid FOR UPDATE`;
    const cart = await quoteCart(client, cartId);
    const current = await quoteSnapshot(client, cart, snapshot.destination, snapshot.branchId);
    if (fingerprint(current) !== fingerprint(snapshot)) shippingError("SHIPPING_QUOTE_STALE", "El carrito cambió. Vuelva a cotizar.");
    if (await client.shipping_quotes.count({ where: { cart_id: cartId, created_at: { gt: new Date(Date.now() - 60000) } } }) >= 20) shippingError("SHIPPING_RATE_LIMITED", "Espere un minuto antes de volver a cotizar.", 429);
    const quotes = [];
    for (const service of services) quotes.push(await client.shipping_quotes.create({ data: {
      cart_id: cartId, branch_id: snapshot.branchId, environment: config.mode,
      snapshot, fingerprint: fingerprint(snapshot), service_code: service.serviceCode, service_name: service.service,
      conditions: service.conditions, provider_cost: service.providerCost,
      customer_charge: shippingCharge(snapshot.subtotal, snapshot.discount, service.providerCost, config.threshold),
      free_threshold: config.threshold, expires_at: new Date(now.getTime() + config.quoteTtlMs),
    } }));
    return quotes.map(mapQuote);
  });
}
export function mapQuote(q) {
  return { id: q.id, service: q.service_name, conditions: q.conditions, customerCharge: Number(q.customer_charge),
    // Provider cost is deliberately internal. The quote response communicates what the buyer pays.
    synthetic: q.environment === "synthetic", environment: q.environment, expiresAt: q.expires_at,
    branchId: q.branch_id, branchName: q.snapshot.branchName, freeShipping: Number(q.snapshot.subtotal) - Number(q.snapshot.discount) > Number(q.free_threshold) };
}
export async function validateShippingQuote(client, cart, quoteId, now = new Date()) {
  const config = shippingConfiguration();
  const quote = quoteId && await client.shipping_quotes.findUnique({ where: { id: quoteId } });
  if (!quote || quote.cart_id !== cart.id || quote.environment !== config.mode || config.mode === "disabled") shippingError("SHIPPING_QUOTE_REQUIRED", "Seleccione una cotización válida para este carrito.");
  if (quote.expires_at <= now) shippingError("SHIPPING_QUOTE_EXPIRED", "La cotización venció. Vuelva a calcular el despacho.");
  const current = await quoteSnapshot(client, await quoteCart(client, cart.id), quote.snapshot.destination, quote.branch_id);
  if (fingerprint(current) !== quote.fingerprint || Number(quote.free_threshold) !== config.threshold || Number(quote.customer_charge) !== shippingCharge(current.subtotal, current.discount, Number(quote.provider_cost), config.threshold)) shippingError("SHIPPING_QUOTE_STALE", "El carrito, origen, embalaje o política cambió. Vuelva a cotizar.");
  return quote;
}

export async function createShipment(client, sale, quote) {
  return client.shipping_shipments.create({ data: { sale_id: sale.id, quote_id: quote.id, reference: `STYLO-${randomUUID()}`,
    operations: { create: { operation: "ORDER_CREATED", details: { environment: quote.environment } } } } });
}
export async function shipmentForSale(saleId, client = prisma) {
  return client.shipping_shipments.findUnique({ where: { sale_id: saleId }, include: {
    quote: true, events: { orderBy: [{ occurred_at: "desc" }, { received_at: "desc" }], take: 200 },
    operations: { orderBy: { created_at: "desc" }, take: 100 },
  } });
}
export function mapShipment(row, internal = false) {
  if (!row) return null;
  return {
    id: row.id, state: row.state, carrier: "Chilexpress", ot: row.ot, synthetic: row.quote.environment === "synthetic", environment: row.quote.environment,
    service: row.quote.service_name, issuedService: row.issued_service, customerCharge: Number(row.quote.customer_charge),
    lastCheckedAt: row.last_checked_at, nextSyncAt: row.next_sync_at, lastErrorCode: row.last_error_code,
    providerStatus: row.provider_status, handedOverAt: row.handed_over_at, labelAvailable: Boolean(row.label_data) || Boolean(row.ot),
    events: row.events.map((e) => ({ id: e.id, code: e.code, description: e.description, occurredAt: e.occurred_at, receivedAt: e.received_at, motive: e.motive, location: e.location })),
    ...(internal ? { providerCost: Number(row.quote.provider_cost), reference: row.reference,
      origin: { branchId: row.quote.branch_id, branchName: row.quote.snapshot.branchName }, destination: row.quote.snapshot.destination,
      parcel: row.quote.snapshot.parcel, operations: row.operations.map((o) => ({ operation: o.operation, actorId: o.actor_id, details: o.details, createdAt: o.created_at })) } : {}),
  };
}
export async function shippingOperation(client, shipmentId, actorId, operation, details = {}) {
  await client.shipping_operations.create({ data: { shipment_id: shipmentId, actor_id: actorId ?? null, operation, details } });
}
export async function lockShipment(client, saleId) {
  // Same lock order as commercial cancellation/payment and reservation expiry.
  await client.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
  await client.$queryRaw`SELECT id FROM shipping_shipments WHERE sale_id = ${saleId}::uuid FOR UPDATE`;
  const row = await shipmentForSale(saleId, client);
  if (!row) shippingError("SHIPMENT_NOT_FOUND", "Este pedido no tiene un despacho registrado.", 404);
  return row;
}
export async function assertShippable(client, row) {
  const sale = await client.sales.findUnique({ where: { id: row.sale_id }, include: { sale_payments: true, inventory_reservations: true, sale_items: { include: { products_sale_items_product_idToproducts: true } }, store_carts: true } });
  const paid = sale.sale_payments.reduce((s, p) => s + Number(p.amount_cents), 0);
  if (!["PAID", "IN_PREPARATION", "READY"].includes(sale.status) || paid < Number(sale.total_cents) || sale.fulfillment_method !== "DELIVERY" || sale.branch_id !== row.quote.branch_id) shippingError("SHIPMENT_ORDER_INVALID", "El despacho requiere un pedido pagado y autorizado para preparación.");
  for (const i of sale.sale_items) if (i.products_sale_items_product_idToproducts.inventory_mode === "TRACKED" && !sale.inventory_reservations.some((r) => r.product_id === i.product_id && ["HELD", "COMMITTED"].includes(r.status) && !r.expires_at)) shippingError("SHIPMENT_STOCK_NOT_COMMITTED", "El pedido no conserva unidades comprometidas válidas.");
  const branch = await client.branches.findUnique({ where: { id: sale.branch_id } });
  if (!branch?.is_active || !branch.shipping_enabled || !branch.shipping_origin?.validated) shippingError("SHIPPING_ORIGIN_UNAVAILABLE", "El origen logístico está deshabilitado.");
  if (!row.ot && fingerprint(branch.shipping_origin) !== fingerprint(row.quote.snapshot.origin)) shippingError("SHIPMENT_ORIGIN_CHANGED", "Los datos de origen cambiaron después de la compra; se requiere revisión antes de emitir la OT.");
  return sale;
}

export async function queueShippingEmail(client, row, operation) {
  const cart = await client.store_carts.findFirst({ where: { sale_id: row.sale_id } });
  if (!cart?.buyer_email) return;
  const key = `shipping:${row.id}:${operation}`;
  await client.transactional_email_outbox.upsert({ where: { deduplication_key: key }, update: {}, create: {
    deduplication_key: key, recipient_email: cart.buyer_email, sale_id: row.sale_id,
    template_code: "SHIPPING_UPDATE", payload: { stage: operation, ot: row.ot, synthetic: row.quote.environment === "synthetic" },
  } });
}

export async function handOverShipment(client, row, actorId, evidence) {
  await assertShippable(client, row);
  await settleSaleInventory(client, row.sale_id, "SALE", actorId);
  await client.shipping_shipments.update({ where: { id: row.id }, data: { state: "HANDED_OVER", handed_over_at: new Date() } });
  await shippingOperation(client, row.id, actorId, "HANDED_OVER", { evidence });
  await queueShippingEmail(client, row, "HANDED_OVER");
}
