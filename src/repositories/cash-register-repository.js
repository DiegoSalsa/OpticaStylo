import { prisma } from "../db/prisma.js";

function mapMovement(row) {
  return { amountCents: Number(row.amount_cents), createdAt: row.created_at, id: row.id, movementType: row.movement_type, reason: row.reason };
}

async function findSessionWithClient(client, sessionId) {
  const row = await client.cash_register_sessions.findUnique({
    include: { cash_register_movements: { orderBy: [{ created_at: "asc" }, { id: "asc" }] } },
    where: { id: sessionId },
  });
  if (!row) return null;
  const interval = { gte: row.opened_at, ...(row.closed_at ? { lte: row.closed_at } : {}) };
  const cash = await client.sale_payments.aggregate({
    _sum: { amount_cents: true }, where: { paid_at: interval, payment_method: "CASH" },
  });
  const manualIn = row.cash_register_movements.filter((item) => item.movement_type === "MANUAL_IN")
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const manualOut = row.cash_register_movements.filter((item) => item.movement_type === "MANUAL_OUT")
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  return {
    cashPaymentsCents: Number(cash._sum.amount_cents ?? 0), closedAt: row.closed_at,
    closingCountedCents: row.closing_counted_cents == null ? null : Number(row.closing_counted_cents),
    closingNotes: row.closing_notes,
    differenceCents: row.difference_cents == null ? null : Number(row.difference_cents),
    expectedAmountCents: row.expected_amount_cents == null
      ? Number(row.opening_amount_cents) + Number(cash._sum.amount_cents ?? 0) + manualIn - manualOut
      : Number(row.expected_amount_cents),
    id: row.id, isTestConfiguration: row.is_test_configuration,
    manualInCents: manualIn, manualOutCents: manualOut,
    movements: row.cash_register_movements.map(mapMovement), openedAt: row.opened_at,
    openingAmountCents: Number(row.opening_amount_cents), openingNotes: row.opening_notes,
    status: row.status,
  };
}

export async function findOpenCashRegisterSession() {
  const row = await prisma.cash_register_sessions.findFirst({ select: { id: true }, where: { status: "OPEN" } });
  return row ? findSessionWithClient(prisma, row.id) : null;
}

export async function openCashRegister(input, actorUserId) {
  return prisma.$transaction(async (client) => {
    const opened = await client.cash_register_sessions.create({ data: {
      opened_by: actorUserId, opening_amount_cents: input.openingAmountCents,
      opening_notes: input.openingNotes,
    } });
    return findSessionWithClient(client, opened.id);
  });
}

export async function createCashRegisterMovement(sessionId, movement, actorUserId) {
  return prisma.$transaction(async (client) => {
    const session = await client.cash_register_sessions.findUnique({ where: { id: sessionId } });
    if (!session) return { reason: "CASH_REGISTER_NOT_FOUND" };
    if (session.status !== "OPEN") return { reason: "CASH_REGISTER_CLOSED" };
    await client.cash_register_movements.create({ data: {
      amount_cents: movement.amountCents, created_by: actorUserId,
      movement_type: movement.movementType, reason: movement.reason, session_id: sessionId,
    } });
    return { reason: null, session: await findSessionWithClient(client, sessionId) };
  }, { isolationLevel: "Serializable" });
}

export async function closeCashRegister(sessionId, closing, actorUserId) {
  return prisma.$transaction(async (client) => {
    const session = await findSessionWithClient(client, sessionId);
    if (!session) return { reason: "CASH_REGISTER_NOT_FOUND" };
    if (session.status !== "OPEN") return { reason: "CASH_REGISTER_CLOSED" };
    const expected = session.openingAmountCents + session.cashPaymentsCents
      + session.manualInCents - session.manualOutCents;
    await client.cash_register_sessions.update({ data: {
      closed_at: new Date(), closed_by: actorUserId,
      closing_counted_cents: closing.closingCountedCents,
      closing_notes: closing.closingNotes,
      difference_cents: closing.closingCountedCents - expected,
      expected_amount_cents: expected, status: "CLOSED",
    }, where: { id: sessionId } });
    return { reason: null, session: await findSessionWithClient(client, sessionId) };
  }, { isolationLevel: "Serializable" });
}
