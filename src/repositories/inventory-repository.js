import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { AppError } from "../utils/app-error.js";

export function inventoryError(code, message, status = 409) { throw new AppError({ code, message, status }); }
export const mapBranch = (row) => ({ id: row.id, code: row.code, name: row.name, address: row.address, pickupEnabled: row.pickup_enabled, isActive: row.is_active, informationSource: row.information_source });
export const mapStock = (row) => row ? { onHand: row.on_hand, reserved: row.reserved, available: row.on_hand - row.reserved, version: row.version, countedAt: row.counted_at } : { onHand: null, reserved: 0, available: null, version: null, countedAt: null };

export async function inventoryBranchAccess(actor, branchId, client = prisma) {
  if (!(actor?.permissions ?? []).includes("inventory.manage_all") && !await client.user_branches.findUnique({ where: { user_id_branch_id: { user_id: actor.userId, branch_id: branchId } } })) {
    inventoryError("BRANCH_ACCESS_DENIED", "No tiene acceso a esa sucursal.", 403);
  }
}
export async function listInventoryBranches(actor = null) {
  const rows = await prisma.branches.findMany({ where: {
    is_active: true,
    ...(actor && !actor.permissions.includes("inventory.manage_all") ? { user_branches: { some: { user_id: actor.userId } } } : {}),
  }, orderBy: { name: "asc" } });
  return rows.map(mapBranch);
}
export async function assertBranch(client, branchId, pickup = false) {
  if (!branchId) inventoryError("BRANCH_REQUIRED", "Seleccione una sucursal para continuar.", 400);
  const branch = await client.branches.findUnique({ where: { id: branchId } });
  if (!branch?.is_active || (pickup && !branch.pickup_enabled)) inventoryError("BRANCH_UNAVAILABLE", "La sucursal no está habilitada para esta operación.");
  return branch;
}
async function lockStock(client, branchId, productId) {
  const key = `${branchId}:${productId}`;
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  return client.inventory_stocks.findUnique({ where: { branch_id_product_id: { branch_id: branchId, product_id: productId } } });
}
async function writeStock(client, previous, branchId, productId, onHand, reserved, event) {
  if (!Number.isSafeInteger(onHand) || onHand < reserved || onHand > 1_000_000_000 || reserved < 0) inventoryError("INSUFFICIENT_STOCK", "La operación supera las existencias disponibles o afecta unidades reservadas.");
  const version = (previous?.version ?? 0) + 1;
  const stock = await client.inventory_stocks.upsert({
    where: { branch_id_product_id: { branch_id: branchId, product_id: productId } },
    create: { branch_id: branchId, product_id: productId, on_hand: onHand, reserved, version },
    update: { on_hand: onHand, reserved, version, ...(event.kind === "ADJUST" || event.kind === "COUNT" ? { counted_at: new Date() } : {}) },
  });
  await client.inventory_movements.create({ data: {
    branch_id: branchId, product_id: productId, stock_version: version,
    before_on_hand: previous?.on_hand ?? null, after_on_hand: onHand,
    before_reserved: previous?.reserved ?? 0, after_reserved: reserved,
    actor_id: event.actorId ?? null, sale_id: event.saleId ?? null, transfer_id: event.transferId ?? null,
    kind: event.kind, reason: event.reason, request_key: event.requestKey ?? null,
  } });
  return mapStock(stock);
}

export async function mutateInventory(input, actor, requestKey) {
  return retryTransaction(prisma, async (client) => {
    await inventoryBranchAccess(actor, input.branchId, client); await assertBranch(client, input.branchId);
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory-request:${requestKey}`}, 0))::text`;
    const existingEvent = await client.inventory_movements.findUnique({ where: { request_key: requestKey } });
    if (existingEvent) {
      if (existingEvent.actor_id !== actor.userId || existingEvent.branch_id !== input.branchId || existingEvent.product_id !== input.productId || existingEvent.kind !== input.kind || existingEvent.reason !== input.reason ||
        (input.kind === "ENTRY" ? existingEvent.after_on_hand - existingEvent.before_on_hand !== input.quantity : input.kind === "EXIT" ? existingEvent.before_on_hand - existingEvent.after_on_hand !== input.quantity : existingEvent.after_on_hand !== input.quantity)) inventoryError("IDEMPOTENCY_CONFLICT", "La clave ya fue utilizada para otra operación.");
      return { ...mapStock(await client.inventory_stocks.findUnique({ where: { branch_id_product_id: { branch_id: input.branchId, product_id: input.productId } } })), repeated: true };
    }
    await client.$queryRaw`SELECT id FROM products WHERE id = ${input.productId}::uuid FOR SHARE`;
    const product = await client.products.findUnique({ where: { id: input.productId } });
    if (!product || product.inventory_mode !== "TRACKED") inventoryError("PRODUCT_NOT_TRACKED", "Este producto no administra existencias físicas.");
    const previous = await lockStock(client, input.branchId, input.productId);
    if (input.kind === "COUNT" && previous) inventoryError("INITIAL_COUNT_EXISTS", "El inventario inicial ya existe. Utilice un ajuste con motivo.");
    if (input.kind !== "COUNT" && !previous) inventoryError("INITIAL_COUNT_REQUIRED", "Primero registre un conteo inicial; sin conteo no equivale a cero.");
    if (["COUNT", "ADJUST"].includes(input.kind) && input.expectedVersion !== (previous?.version ?? null)) inventoryError("STOCK_VERSION_CHANGED", "Las existencias cambiaron. Actualice el conteo antes de confirmar.");
    const onHand = ["COUNT", "ADJUST"].includes(input.kind) ? input.quantity : previous.on_hand + (input.kind === "ENTRY" ? input.quantity : -input.quantity);
    return writeStock(client, previous, input.branchId, input.productId, onHand, previous?.reserved ?? 0, { ...input, actorId: actor.userId, requestKey });
  });
}

export async function reserveSaleInventory(client, saleId, actorId = null) {
  await client.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
  const sale = await client.sales.findUnique({ include: { sale_items: { include: { products_sale_items_product_idToproducts: true } } }, where: { id: saleId } });
  if (!sale || sale.status !== "PENDING") inventoryError("SALE_NOT_PAYABLE", "El pedido no admite una reserva.");
  const branch = await assertBranch(client, sale.branch_id, sale.origin === "ONLINE" && sale.fulfillment_method !== "DELIVERY");
  if (sale.fulfillment_method === "DELIVERY" && (!branch.shipping_enabled || !branch.shipping_origin?.validated)) inventoryError("SHIPPING_ORIGIN_UNAVAILABLE", "La sucursal no es un origen logístico habilitado.");
  for (const item of [...sale.sale_items].sort((a,b) => a.product_id.localeCompare(b.product_id))) {
    const product = item.products_sale_items_product_idToproducts;
    if (!product.is_active || product.inventory_mode === "UNCONFIGURED") inventoryError("INVENTORY_NOT_CONFIGURED", `Falta configurar la disponibilidad de ${product.name}.`);
    if (product.inventory_mode === "ON_DEMAND") continue;
    const previous = await lockStock(client, sale.branch_id, item.product_id);
    const where = { sale_id_product_id: { sale_id: saleId, product_id: item.product_id } };
    const reservation = await client.inventory_reservations.findUnique({ where });
    if (reservation?.status === "COMMITTED" || (reservation?.status === "HELD" && (!reservation.expires_at || reservation.expires_at > new Date()))) continue;
    if (!previous || previous.on_hand - previous.reserved < item.quantity) inventoryError("INSUFFICIENT_STOCK", `No hay ${item.quantity} unidades disponibles de ${product.name} en la sucursal seleccionada.`);
    // Una reserva vencida debe liberarse antes de renovarse, nunca contarse dos veces.
    if (reservation?.status === "HELD") inventoryError("STOCK_RESERVATION_EXPIRED", "La reserva venció. Actualice el pedido antes de reintentar.");
    const data = { branch_id: sale.branch_id, quantity: item.quantity, status: "HELD", expires_at: new Date(Date.now() + 30 * 60_000) };
    await client.inventory_reservations.upsert({ where, create: { ...data, sale_id: saleId, product_id: item.product_id }, update: data });
    await writeStock(client, previous, sale.branch_id, item.product_id, previous.on_hand, previous.reserved + item.quantity, { kind: "RESERVE", actorId, saleId, reason: "Reserva del pedido por 30 minutos mientras no registre pagos." });
  }
}

export async function settleSaleInventory(client, saleId, action, actorId = null) {
  await client.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
  const reservations = await client.inventory_reservations.findMany({ where: { sale_id: saleId }, orderBy: { product_id: "asc" } });
  if (action === "PAYMENT") {
    const sale = await client.sales.findUnique({ include: { sale_items: { include: { products_sale_items_product_idToproducts: true } } }, where: { id: saleId } });
    if (sale.branch_id && sale.sale_items.some((item) => item.products_sale_items_product_idToproducts.inventory_mode === "TRACKED" && !reservations.some((row) => row.product_id === item.product_id && ["HELD","COMMITTED"].includes(row.status)))) inventoryError("STOCK_RESERVATION_EXPIRED", "Renueve la reserva del pedido antes de registrar el pago.");
  }
  for (const row of reservations) {
    if (row.status !== "HELD") continue;
    if (action === "PAYMENT") {
      if (row.expires_at && row.expires_at <= new Date()) inventoryError("STOCK_RESERVATION_EXPIRED", "La reserva venció. El pago requiere revisión antes de acreditar la venta.");
      await client.inventory_reservations.update({ where: { id: row.id }, data: { expires_at: null } });
      continue;
    }
    const previous = await lockStock(client, row.branch_id, row.product_id);
    const status = action === "SALE" ? "COMMITTED" : action === "EXPIRE" ? "EXPIRED" : "RELEASED";
    await writeStock(client, previous, row.branch_id, row.product_id, previous.on_hand - (action === "SALE" ? row.quantity : 0), previous.reserved - row.quantity,
      { kind: action, actorId, saleId, reason: action === "SALE" ? "Venta presencial pagada o pedido entregado: salida física de la reserva." : action === "EXPIRE" ? "Reserva sin pagos vencida." : "Reserva liberada por cancelación o rechazo de pago." });
    await client.inventory_reservations.update({ where: { id: row.id }, data: { status } });
  }
}

export async function expireInventoryReservations({ limit = 1000, deadline = Infinity } = {}) {
  // Deduplicate and limit inside PostgreSQL, rather than Prisma's in-memory
  // distinct, so a maintenance call cannot materialize the entire backlog.
  const rows = await prisma.$queryRaw`SELECT sale_id FROM inventory_reservations
    WHERE status='HELD' AND expires_at<=CURRENT_TIMESTAMP GROUP BY sale_id
    ORDER BY min(expires_at),sale_id LIMIT ${Math.max(1, Math.min(limit, 1000))}`;
  let processed = 0;
  for (const { sale_id: saleId } of rows) {
    if (Date.now() >= deadline) break;
    await retryTransaction(prisma, async (client) => {
    await client.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
    const overdue = await client.inventory_reservations.findFirst({ where: { sale_id: saleId, status: "HELD", expires_at: { lte: new Date() } } });
    if (!overdue) return;
    if (await client.sale_payments.count({ where: { sale_id: saleId } })) { await client.inventory_reservations.updateMany({ where: { sale_id: saleId, status: "HELD" }, data: { expires_at: null } }); return; }
    await settleSaleInventory(client, saleId, "EXPIRE");
    });
    processed++;
  }
  return processed;
}

export async function availabilityForProducts(products, client = prisma, includeNonPickup = false) {
  const branches = await client.branches.findMany({ where: { is_active: true, ...(!includeNonPickup ? { pickup_enabled: true } : {}) }, orderBy: { name: "asc" } });
  const stocks = await client.inventory_stocks.findMany({ where: { product_id: { in: products.map((p) => p.id ?? p.productId) }, branch_id: { in: branches.map((b) => b.id) } } });
  return new Map(products.map((product) => {
    const id = product.id ?? product.productId;
    const mode = product.inventoryMode ?? product.inventory_mode;
    const options = branches.map((branch) => {
      const stock = stocks.find((row) => row.branch_id === branch.id && row.product_id === id);
      const quantity = mode === "TRACKED" ? stock ? stock.on_hand - stock.reserved : null : null;
      return { ...mapBranch(branch), available: (product.isActive ?? product.is_active ?? true) && (mode === "ON_DEMAND" || (mode === "TRACKED" && quantity > 0)), quantity,
        state: mode === "ON_DEMAND" ? "ON_DEMAND" : mode !== "TRACKED" ? "UNCONFIGURED" : !stock ? "UNCOUNTED" : quantity > 0 ? "AVAILABLE" : "OUT_OF_STOCK" };
    });
    return [id, { available: options.some((b) => b.available), exactQuantityKnown: mode === "TRACKED" && options.every((b) => b.quantity !== null), source: "INVENTORY", mode, branches: options }];
  }));
}

export async function onlineAvailabilityForProducts(products, client = prisma) {
  const result = await availabilityForProducts(products, client, true);
  const origins = await client.branches.findMany({ where: { is_active: true, shipping_enabled: true }, select: { id: true } });
  const shippingIds = new Set(origins.map((b) => b.id));
  for (const value of result.values()) {
    value.branches = value.branches.filter((b) => b.pickupEnabled || shippingIds.has(b.id));
    value.available = value.branches.some((b) => b.available);
    value.exactQuantityKnown = value.mode === "TRACKED" && value.branches.every((b) => b.quantity !== null);
  }
  return result;
}

export async function transferInventory(input, actor, requestKey) {
  return retryTransaction(prisma, async (client) => {
    if (input.id) {
      await client.$queryRaw`SELECT id FROM inventory_transfers WHERE id = ${input.id}::uuid FOR UPDATE`;
      const transfer = await client.inventory_transfers.findUnique({ where: { id: input.id } });
      if (!transfer) inventoryError("TRANSFER_NOT_FOUND", "No se encontró la transferencia.", 404);
      const branchId = input.action === "RECEIVE" ? transfer.destination_id : transfer.source_id;
      await inventoryBranchAccess(actor, branchId, client);
      if (transfer.status === (input.action === "RECEIVE" ? "RECEIVED" : "CANCELLED")) return transfer;
      if (transfer.status !== "DISPATCHED") inventoryError("INVALID_TRANSFER_STATE", "La transferencia ya fue completada.");
      const stock = await lockStock(client, branchId, transfer.product_id);
      if (!stock) inventoryError("INITIAL_COUNT_REQUIRED", "La sucursal debe tener un conteo inicial antes de recibir existencias.");
      await writeStock(client, stock, branchId, transfer.product_id, stock.on_hand + transfer.quantity, stock.reserved,
        { kind: input.action === "RECEIVE" ? "TRANSFER_IN" : "TRANSFER_RETURN", actorId: actor.userId, transferId: transfer.id, reason: transfer.reason });
      return client.inventory_transfers.update({ where: { id: input.id }, data: { status: input.action === "RECEIVE" ? "RECEIVED" : "CANCELLED", completed_by: actor.userId, completed_at: new Date() } });
    }
    await inventoryBranchAccess(actor, input.branchId, client);
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory-request:${requestKey}`}, 0))::text`;
    const prior = await client.inventory_transfers.findUnique({ where: { request_key: requestKey } });
    if (prior) {
      if (prior.created_by !== actor.userId || prior.source_id !== input.branchId || prior.destination_id !== input.destinationId || prior.product_id !== input.productId || prior.quantity !== input.quantity || prior.reason !== input.reason) inventoryError("IDEMPOTENCY_CONFLICT", "La clave ya corresponde a otra transferencia.");
      return prior;
    }
    await assertBranch(client, input.branchId); await assertBranch(client, input.destinationId);
    await client.$queryRaw`SELECT id FROM products WHERE id = ${input.productId}::uuid FOR SHARE`;
    const product = await client.products.findUnique({ where: { id: input.productId } });
    if (product?.inventory_mode !== "TRACKED") inventoryError("PRODUCT_NOT_TRACKED", "La transferencia requiere un producto con existencias físicas.");
    const stocks = new Map();
    for (const id of [input.branchId, input.destinationId].sort()) stocks.set(id, await lockStock(client, id, input.productId));
    const source = stocks.get(input.branchId);
    if (!source || !stocks.get(input.destinationId)) inventoryError("INITIAL_COUNT_REQUIRED", "Ambas sucursales deben tener conteo inicial.");
    if (source.on_hand - source.reserved < input.quantity) inventoryError("INSUFFICIENT_STOCK", "El origen no tiene unidades disponibles para transferir.");
    const transfer = await client.inventory_transfers.create({ data: { source_id: input.branchId, destination_id: input.destinationId, product_id: input.productId, quantity: input.quantity, reason: input.reason, created_by: actor.userId, request_key: requestKey } });
    await writeStock(client, source, input.branchId, input.productId, source.on_hand - input.quantity, source.reserved, { kind: "TRANSFER_OUT", actorId: actor.userId, transferId: transfer.id, reason: input.reason });
    return transfer;
  });
}

export async function inventoryOverview(branchId, search, page) {
  const where = { ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } : {}) };
  const [products, total] = await prisma.$transaction([prisma.products.findMany({ where, include: { inventory_stocks: { where: branchId ? { branch_id: branchId } : {}, include: { branches: true } } }, orderBy: { sku: "asc" }, take: 30, skip: (page - 1) * 30 }), prisma.products.count({ where })]);
  return { page, total, totalPages: Math.ceil(total / 30), items: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, mode: p.inventory_mode, ...mapStock(branchId ? p.inventory_stocks[0] : null), locations: p.inventory_stocks.map((row) => ({ branchId: row.branch_id, branchName: row.branches.name, ...mapStock(row) })) })) };
}
