import { prisma } from "../db/prisma.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { INTERNAL_PAGE_SIZE } from "../utils/pagination.js";
import { cashInteger, summarizeCashSession } from "./cash-register-summary.js";
import { inventoryBranchAccess, assertBranch, inventoryError } from "./inventory-repository.js";

const person = { select: { id: true, first_name: true, last_name: true } };
const include = {
  branches: { select: { id: true, name: true } },
  cash_register_terminals: { select: { id: true, name: true } },
  users_cash_register_sessions_opened_byTousers: person,
  users_cash_register_sessions_closed_byTousers: person,
};
const name = (user) => user ? `${user.first_name} ${user.last_name}` : null;
export const cashError = inventoryError;
export const cashReadSnapshot = { isolationLevel: "RepeatableRead" };

export async function readCashPage(model, { page: requestedPage, pageSize }, { where, ...options }) {
  const total = await model.count({ where });
  const totalPages = Math.ceil(total / pageSize);
  const page = Math.min(requestedPage, Math.max(1, totalPages));
  const items = total === 0 ? [] : await model.findMany({
    ...options, where, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { items, page, pageSize, total, totalPages };
}

export async function getCashMovementPage(client, sessionId, pagination) {
  const result = await readCashPage(client.cash_register_movements, pagination, {
    where: { session_id: sessionId },
    include: { users: person, _count: { select: { reversals: { where: { session_id: sessionId } } } } },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  });
  return {
    ...result,
    items: result.items.map((m) => ({
      id: m.id, operationId: m.request_key ?? m.id, movementType: m.movement_type,
      amountCents: cashInteger(m.amount_cents), reason: m.reason, actor: name(m.users),
      createdAt: m.created_at, paymentId: m.payment_id, reversalOf: m.reversal_of, reversed: m._count.reversals > 0,
    })),
  };
}

export async function getCashPaymentPage(client, sessionId, pagination) {
  const result = await readCashPage(client.sale_payments, pagination, {
    where: { cash_session_id: sessionId },
    include: { sales: { select: { sale_number: true } } },
    orderBy: [{ paid_at: "asc" }, { id: "asc" }],
  });
  return {
    ...result,
    items: result.items.map((p) => ({
      id: p.id, saleId: p.sale_id, saleNumber: cashInteger(p.sales.sale_number),
      amountCents: cashInteger(p.amount_cents), paymentMethod: p.payment_method,
      reference: p.reference, paidAt: p.paid_at,
    })),
  };
}

export async function cashSessionAccess(client, sessionId, actor, lock = false) {
  if (lock) await client.$queryRaw`SELECT id FROM cash_register_sessions WHERE id=${sessionId}::uuid FOR UPDATE`;
  const row = await client.cash_register_sessions.findUnique({ where: { id: sessionId } });
  if (!row) cashError("CASH_REGISTER_NOT_FOUND", "No se encontró la sesión de caja.", 404);
  if (!row.branch_id) cashError("LEGACY_CASH_REGISTER", "Esta sesión histórica no tiene sucursal. Requiere conciliación; no puede operarse.");
  await inventoryBranchAccess(actor, row.branch_id, client);
  if (!actor.permissions.includes("cash.manage_all") && row.opened_by !== actor.userId) cashError("CASH_ACCESS_DENIED", "Esta caja está a cargo de otro responsable.", 403);
  return row;
}
export async function lockPaymentSession(client, sale, sessionId, actor) {
  let id = sessionId;
  if (!id) {
    const own = await client.cash_register_sessions.findMany({ where: { branch_id: sale.branch_id, opened_by: actor.userId, status: "OPEN" }, take: 2 });
    if (own.length === 1) id = own[0].id;
  }
  if (!id) cashError("CASH_SESSION_REQUIRED", "Seleccione una sesión de caja abierta para registrar el cobro.");
  const session = await cashSessionAccess(client, id, actor, true);
  if (session.status !== "OPEN") cashError("CASH_REGISTER_CLOSED", "La caja ya está cerrada.");
  if (session.branch_id !== sale.branch_id) cashError("CASH_BRANCH_MISMATCH", "La caja y la venta deben pertenecer a la misma sucursal.");
  return session;
}
export async function findCashSession(sessionId, client, includeLedgers = true) {
  const row = await client.cash_register_sessions.findUnique({ include, where: { id: sessionId } });
  if (!row) return null;

  const totals = row.status === "CLOSED" && row.closing_summary ? row.closing_summary : await summarizeCashSession(client, row);
  const result = {
    ...totals, id: row.id, status: row.status, branchId: row.branch_id,
    branch: row.branches, terminal: row.cash_register_terminals,
    openedBy: { id: row.opened_by, name: name(row.users_cash_register_sessions_opened_byTousers) },
    closedBy: name(row.users_cash_register_sessions_closed_byTousers),
    openedAt: row.opened_at, closedAt: row.closed_at, openingNotes: row.opening_notes, closingNotes: row.closing_notes,
    openingAmountCents: cashInteger(row.opening_amount_cents),
    closingCountedCents: row.closing_counted_cents == null ? null : cashInteger(row.closing_counted_cents),
    differenceCents: row.difference_cents == null ? null : cashInteger(row.difference_cents),
  };
  if (!includeLedgers) return result;

  const page = { page: 1, pageSize: INTERNAL_PAGE_SIZE };
  const { items: movements, ...movementPagination } = await getCashMovementPage(client, sessionId, page);
  const { items: payments, ...paymentPagination } = await getCashPaymentPage(client, sessionId, page);
  return { ...result, movements, payments, movementPagination, paymentPagination };
}

export async function findOpenCashRegisterSession(terminalId, actor, includeLedgers) {
  return prisma.$transaction(async (client) => {
    const row = await client.cash_register_sessions.findFirst({ select: { id: true }, where: { terminal_id: terminalId, status: "OPEN" } });
    if (!row) return null;
    await cashSessionAccess(client, row.id, actor);
    return findCashSession(row.id, client, includeLedgers);
  }, cashReadSnapshot);
}

export async function openCashRegister(input, actor, includeLedgers) {
  return retryTransaction(prisma, async (client) => {
    await inventoryBranchAccess(actor, input.branchId, client); await assertBranch(client, input.branchId);
    await client.$queryRaw`SELECT id FROM cash_register_terminals WHERE id=${input.terminalId}::uuid FOR UPDATE`;
    const terminal = await client.cash_register_terminals.findUnique({ where: { id: input.terminalId } });
    if (!terminal?.is_active || terminal.branch_id !== input.branchId) cashError("CASH_TERMINAL_UNAVAILABLE", "Seleccione una caja activa de esta sucursal.");
    if (await client.cash_register_sessions.findFirst({ where: { terminal_id: terminal.id, status: "OPEN" } })) cashError("CASH_REGISTER_ALREADY_OPEN", "Ese punto de cobro ya tiene una sesión abierta.");
    const row = await client.cash_register_sessions.create({ data: { branch_id: input.branchId, terminal_id: input.terminalId, opened_by: actor.userId, opening_amount_cents: input.openingAmountCents, opening_notes: input.openingNotes, is_test_configuration: false } });
    return findCashSession(row.id, client, includeLedgers);
  });
}
export async function createCashRegisterMovement(sessionId, movement, actor, requestKey, includeLedgers) {
  return retryTransaction(prisma, async (client) => {
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cash-movement:${requestKey}`},0))::text`;
    const session = await cashSessionAccess(client, sessionId, actor, true);
    const existing = await client.cash_register_movements.findUnique({ where: { request_key: requestKey } });
    if (existing) {
      if (existing.session_id !== sessionId || existing.created_by !== actor.userId || existing.reason !== movement.reason || existing.movement_type !== movement.movementType || (movement.movementType === "REVERSAL" ? existing.reversal_of !== movement.reversalOf : Number(existing.amount_cents) !== movement.amountCents)) cashError("IDEMPOTENCY_CONFLICT", "La clave corresponde a otro movimiento.");
      return findCashSession(sessionId, client, includeLedgers);
    }
    if (session.status !== "OPEN") cashError("CASH_REGISTER_CLOSED", "No puede registrar movimientos después del cierre.");
    let amount = movement.amountCents;
    if (movement.movementType === "REVERSAL") {
      if (!actor.permissions.includes("cash.adjust")) cashError("CASH_ADJUST_DENIED", "El reverso requiere autorización administrativa.",403);
      const original = await client.cash_register_movements.findUnique({ where: { id: movement.reversalOf } });
      if (!original || original.session_id !== sessionId || !["MANUAL_IN","MANUAL_OUT","WITHDRAWAL"].includes(original.movement_type) || await client.cash_register_movements.findUnique({ where: { reversal_of: original.id } })) cashError("INVALID_CASH_REVERSAL", "Solo puede reversar una vez un movimiento manual de esta sesión.");
      amount = original.amount_cents;
    }
    await client.cash_register_movements.create({ data: { session_id: sessionId, amount_cents: amount, movement_type: movement.movementType, reason: movement.reason, created_by: actor.userId, request_key: requestKey, reversal_of: movement.reversalOf ?? null } });
    const result = await findCashSession(sessionId, client, includeLedgers);
    if (result.expectedAmountCents < 0) cashError("CASH_INSUFFICIENT_FUNDS", "El movimiento supera el efectivo esperado en la caja.");
    return result;
  });
}
export async function closeCashRegister(sessionId, closing, actor, includeLedgers) {
  return retryTransaction(prisma, async (client) => {
    const row = await cashSessionAccess(client, sessionId, actor, true);
    if (row.status === "CLOSED") {
      if (Number(row.closing_counted_cents) !== closing.closingCountedCents || row.closing_notes !== closing.closingNotes) cashError("CASH_REGISTER_CLOSED", "El cierre original no puede modificarse.");
      return findCashSession(sessionId, client, includeLedgers);
    }
    const session = await findCashSession(sessionId, client, false);
    const difference = cashInteger(BigInt(closing.closingCountedCents) - BigInt(session.expectedAmountCents));
    if ((difference !== 0 || session.pending.length) && !closing.closingNotes) cashError("CASH_CLOSING_NOTES_REQUIRED", "Justifique la diferencia y los saldos pendientes antes de cerrar.",400);
    const { cashPaymentsCents, electronicPaymentsCents, receivedCents, byMethod, manualInCents, manualOutCents, withdrawalCents, reversalCents, paymentCount, saleCount, expectedAmountCents, pending } = session;
    await client.cash_register_sessions.update({ where: { id: sessionId }, data: { status: "CLOSED", closed_at: new Date(), closed_by: actor.userId, closing_counted_cents: closing.closingCountedCents, closing_notes: closing.closingNotes, expected_amount_cents: expectedAmountCents, difference_cents: difference,
      closing_summary: { cashPaymentsCents, electronicPaymentsCents, receivedCents, byMethod, manualInCents, manualOutCents, withdrawalCents, reversalCents, paymentCount, saleCount, expectedAmountCents, pending } } });
    return findCashSession(sessionId, client, includeLedgers);
  });
}
