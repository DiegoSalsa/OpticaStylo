import { createHash } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { requirePermissions } from "../auth/require-permission.js";
import { inventoryId, inventoryQuantity, inventoryText, validateInventoryMovement, validateInventoryTransfer } from "../validations/inventory-validation.js";
import { normalizeInventorySku, parseInventoryCsv } from "../utils/inventory-import.js";
import { assertBranch, expireInventoryReservations, inventoryBranchAccess, inventoryError, inventoryOverview, listInventoryBranches, mapBranch, mapStock, mutateInventory, reserveSaleInventory, transferInventory } from "../repositories/inventory-repository.js";

export async function getInventoryBranches(actor, destinations = false) { requirePermissions(actor, ["inventory.read"]); return listInventoryBranches(destinations ? null : actor); }
export async function getInventory(query, actor) {
  requirePermissions(actor, ["inventory.read"]);
  const consolidated = query.get("consolidated") === "true";
  if (consolidated) requirePermissions(actor, ["inventory.manage_all"]);
  const branchId = consolidated ? null : inventoryId(query.get("branchId"));
  if (branchId) await inventoryBranchAccess(actor, branchId);
  const page = Number(query.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1) inventoryError("INVALID_INVENTORY_DATA", "La página no es válida.", 400);
  const search = (query.get("search") ?? "").trim();
  if (search.length > 100) inventoryError("INVALID_INVENTORY_DATA", "La búsqueda supera 100 caracteres.", 400);
  await expireInventoryReservations();
  return inventoryOverview(branchId, search, page);
}
export async function getInventoryMovements(query, actor) {
  requirePermissions(actor, ["inventory.read"]);
  const branchId = inventoryId(query.get("branchId")); await inventoryBranchAccess(actor, branchId);
  const page = Number(query.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) inventoryError("INVALID_INVENTORY_DATA", "La página no es válida.", 400);
  const rows = await prisma.inventory_movements.findMany({ where: { branch_id: branchId, ...(query.get("productId") ? { product_id: inventoryId(query.get("productId")) } : {}) }, include: { inventory_stocks: { include: { products: { select: { name: true, sku: true } } } }, users: { select: { first_name: true, last_name: true } } }, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 100, skip: (page - 1) * 100 });
  return rows.map((row) => ({ id: row.id, productId: row.product_id, productName: row.inventory_stocks.products.name, productSku: row.inventory_stocks.products.sku, kind: row.kind, before: row.before_on_hand, after: row.after_on_hand,
    difference: row.before_on_hand == null ? null : row.after_on_hand - row.before_on_hand, reservedBefore: row.before_reserved, reservedAfter: row.after_reserved,
    reason: row.reason, actor: row.users ? `${row.users.first_name} ${row.users.last_name}` : "Sistema", createdAt: row.created_at, saleId: row.sale_id, transferId: row.transfer_id }));
}
export async function postInventoryMovement(input, actor, requestKey) {
  requirePermissions(actor, ["inventory.write"]);
  if (!requestKey) inventoryError("IDEMPOTENCY_KEY_REQUIRED", "La operación requiere una clave de idempotencia.", 400);
  return mutateInventory(validateInventoryMovement(input), actor, requestKey);
}
export async function postInventoryTransfer(input, actor, requestKey) {
  requirePermissions(actor, ["inventory.write"]);
  if (!input?.id && !requestKey) inventoryError("IDEMPOTENCY_KEY_REQUIRED", "La transferencia requiere una clave de idempotencia.", 400);
  await expireInventoryReservations();
  return transferInventory(validateInventoryTransfer(input), actor, requestKey);
}
export async function getInventoryTransfers(query, actor) {
  requirePermissions(actor, ["inventory.read"]);
  const branchId = inventoryId(query.get("branchId")); await inventoryBranchAccess(actor, branchId);
  return prisma.inventory_transfers.findMany({ where: { OR: [{ source_id: branchId }, { destination_id: branchId }] }, include: { source: true, destination: true, products: { select: { name: true, sku: true } } }, orderBy: { created_at: "desc" }, take: 100 });
}
export async function configureInventoryBranch(input, actor) {
  requirePermissions(actor, ["inventory.manage_all"]);
  if (input.action === "ASSIGN") {
    const branchId = inventoryId(input.branchId), userId = inventoryId(input.userId);
    await assertBranch(prisma, branchId);
    if (input.remove === true) { await prisma.user_branches.deleteMany({ where: { user_id: userId, branch_id: branchId } }); return { assigned: false }; }
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user?.is_active) inventoryError("USER_NOT_FOUND", "No se encontró el empleado activo.", 404);
    await prisma.user_branches.upsert({ where: { user_id_branch_id: { user_id: userId, branch_id: branchId } }, create: { user_id: userId, branch_id: branchId }, update: {} });
    return { assigned: true };
  }
  const data = { name: inventoryText(input.name, "El nombre", 200), address: input.address ? inventoryText(input.address, "La dirección") : null,
    information_source: inventoryText(input.informationSource, "La fuente de la información"), pickup_enabled: input.pickupEnabled === true };
  if (input.id) return mapBranch(await prisma.branches.update({ where: { id: inventoryId(input.id) }, data }));
  return mapBranch(await prisma.branches.create({ data: { ...data, code: inventoryText(input.code, "El código", 80).toUpperCase() } }));
}
export async function renewInventoryReservation(saleId, actor) {
  requirePermissions(actor, ["sales.update"]);
  await expireInventoryReservations();
  const id = inventoryId(saleId), sale = await prisma.sales.findUnique({ where: { id } });
  if (!sale) inventoryError("SALE_NOT_FOUND", "No se encontró el pedido.", 404);
  await inventoryBranchAccess(actor, sale.branch_id);
  await retryTransaction(prisma, (client) => reserveSaleInventory(client, id, actor.userId));
  return { reserved: true };
}
export async function previewInventoryImport(input, actor) {
  requirePermissions(actor, ["inventory.write"]);
  const branchId = inventoryId(input.branchId); await inventoryBranchAccess(actor, branchId);
  let entries;
  try { entries = parseInventoryCsv(input.csv); } catch (error) { inventoryError("INVALID_INVENTORY_IMPORT", error.message, 400); }
  const products = await prisma.products.findMany({ select: { id: true, sku: true, name: true, inventory_mode: true, inventory_stocks: { where: { branch_id: branchId } } } });
  const seen = new Set();
  return { branchId, rows: entries.map((entry) => {
    const normalized = normalizeInventorySku(entry.sku);
    const matches = products.filter((p) => normalizeInventorySku(p.sku) === normalized);
    const duplicate = seen.has(normalized); seen.add(normalized);
    const product = matches.length === 1 ? matches[0] : null;
    const stock = product?.inventory_stocks[0];
    const error = duplicate ? "SKU repetido en el archivo" : !Number.isSafeInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > 1_000_000 ? "Cantidad no válida" : matches.length > 1 ? "SKU ambiguo; requiere conciliación" : !product ? "SKU sin producto; registrar o conciliar el catálogo primero" : product.inventory_mode !== "TRACKED" ? "Producto sin control físico configurado" : null;
    return { ...entry, productId: product?.id ?? null, name: product?.name ?? null, current: mapStock(stock), error };
  }) };
}
export async function applyInventoryImport(input, actor, requestKey) {
  requirePermissions(actor, ["inventory.write"]);
  if (!requestKey || input.confirm !== true || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 500) inventoryError("IMPORT_CONFIRMATION_REQUIRED", "Revise las filas y confirme explícitamente la carga.", 400);
  const branchId = inventoryId(input.branchId); await inventoryBranchAccess(actor, branchId);
  const rows = input.rows.map((row) => ({ ...validateInventoryMovement({ ...row, branchId, kind: row.current?.version == null ? "COUNT" : "ADJUST", expectedVersion: row.current?.version, reason: inventoryText(input.reason, "El origen de la carga") }), quantity: inventoryQuantity(row.quantity, true) }));
  if (new Set(rows.map((r) => r.productId)).size !== rows.length) inventoryError("INVALID_INVENTORY_IMPORT", "No puede repetir productos en una carga.", 400);
  // Un lote se previsualiza y se aplica por filas idempotentes: si hay un
  // conflicto, se informa la fila y las ya registradas no se duplican al reintentar.
  const results = [];
  for (const row of rows) {
    try { results.push({ productId: row.productId, success: true, stock: await mutateInventory(row, actor, createHash("sha256").update(`${requestKey}:${row.productId}`).digest("hex")) }); }
    catch (error) { results.push({ productId: row.productId, success: false, error: error.message }); }
  }
  return { results, completed: results.every((r) => r.success), batchId: requestKey };
}
