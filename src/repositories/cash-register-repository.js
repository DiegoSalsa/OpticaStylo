import { executeQuery, executeTransaction } from "../db/query.js";

function mapMovement(row) {
  return {
    amountCents: Number(row.amount_cents),
    createdAt: row.created_at,
    id: row.id,
    movementType: row.movement_type,
    reason: row.reason,
  };
}

function mapSession(row, movements = []) {
  if (!row) return null;
  return {
    cashPaymentsCents: Number(row.cash_payments_cents ?? 0),
    closedAt: row.closed_at,
    closingCountedCents: row.closing_counted_cents == null
      ? null
      : Number(row.closing_counted_cents),
    closingNotes: row.closing_notes,
    differenceCents: row.difference_cents == null ? null : Number(row.difference_cents),
    expectedAmountCents: row.expected_amount_cents == null
      ? Number(row.expected_cents ?? row.opening_amount_cents)
      : Number(row.expected_amount_cents),
    id: row.id,
    isTestConfiguration: row.is_test_configuration,
    manualInCents: Number(row.manual_in_cents ?? 0),
    manualOutCents: Number(row.manual_out_cents ?? 0),
    movements,
    openedAt: row.opened_at,
    openingAmountCents: Number(row.opening_amount_cents),
    openingNotes: row.opening_notes,
    status: row.status,
  };
}

const SESSION_SUMMARY = `
  SELECT cash_register_sessions.*,
    COALESCE((
      SELECT SUM(sale_payments.amount_cents)
      FROM sale_payments
      WHERE sale_payments.payment_method = 'CASH'
        AND sale_payments.paid_at >= cash_register_sessions.opened_at
        AND sale_payments.paid_at <= COALESCE(cash_register_sessions.closed_at, CURRENT_TIMESTAMP)
    ), 0) AS cash_payments_cents,
    COALESCE((
      SELECT SUM(amount_cents) FROM cash_register_movements
      WHERE session_id = cash_register_sessions.id AND movement_type = 'MANUAL_IN'
    ), 0) AS manual_in_cents,
    COALESCE((
      SELECT SUM(amount_cents) FROM cash_register_movements
      WHERE session_id = cash_register_sessions.id AND movement_type = 'MANUAL_OUT'
    ), 0) AS manual_out_cents
  FROM cash_register_sessions
`;

async function findSessionWithClient(client, sessionId) {
  const sessionResult = await client.query(`${SESSION_SUMMARY} WHERE id = $1`, [sessionId]);
  const row = sessionResult.rows[0];
  if (!row) return null;
  const movementsResult = await client.query(
    `SELECT * FROM cash_register_movements
     WHERE session_id = $1 ORDER BY created_at, id`,
    [sessionId],
  );
  return mapSession(row, movementsResult.rows.map(mapMovement));
}

export async function findOpenCashRegisterSession() {
  const result = await executeQuery(`${SESSION_SUMMARY} WHERE status = 'OPEN'`);
  const row = result.rows[0];
  if (!row) return null;
  const movementsResult = await executeQuery(
    `SELECT * FROM cash_register_movements
     WHERE session_id = $1 ORDER BY created_at, id`,
    [row.id],
  );
  return mapSession(row, movementsResult.rows.map(mapMovement));
}

export async function openCashRegister(input, actorUserId) {
  return executeTransaction(async (client) => {
    const opened = await client.query(
      `INSERT INTO cash_register_sessions (
         opening_amount_cents, opening_notes, opened_by
       ) VALUES ($1, $2, $3) RETURNING id`,
      [input.openingAmountCents, input.openingNotes, actorUserId],
    );
    return findSessionWithClient(client, opened.rows[0].id);
  });
}

export async function createCashRegisterMovement(sessionId, movement, actorUserId) {
  return executeTransaction(async (client) => {
    const session = await client.query(
      "SELECT status FROM cash_register_sessions WHERE id = $1 FOR UPDATE",
      [sessionId],
    );
    if (!session.rows[0]) return { reason: "CASH_REGISTER_NOT_FOUND" };
    if (session.rows[0].status !== "OPEN") return { reason: "CASH_REGISTER_CLOSED" };
    await client.query(
      `INSERT INTO cash_register_movements (
         session_id, movement_type, amount_cents, reason, created_by
       ) VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, movement.movementType, movement.amountCents, movement.reason, actorUserId],
    );
    return { reason: null, session: await findSessionWithClient(client, sessionId) };
  });
}

export async function closeCashRegister(sessionId, closing, actorUserId) {
  return executeTransaction(async (client) => {
    const session = await client.query(
      `${SESSION_SUMMARY} WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    const row = session.rows[0];
    if (!row) return { reason: "CASH_REGISTER_NOT_FOUND" };
    if (row.status !== "OPEN") return { reason: "CASH_REGISTER_CLOSED" };
    const expected = Number(row.opening_amount_cents)
      + Number(row.cash_payments_cents)
      + Number(row.manual_in_cents)
      - Number(row.manual_out_cents);
    await client.query(
      `UPDATE cash_register_sessions
       SET status = 'CLOSED', closing_counted_cents = $2,
           expected_amount_cents = $3, difference_cents = $4,
           closing_notes = $5, closed_by = $6, closed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        sessionId,
        closing.closingCountedCents,
        expected,
        closing.closingCountedCents - expected,
        closing.closingNotes,
        actorUserId,
      ],
    );
    return { reason: null, session: await findSessionWithClient(client, sessionId) };
  });
}
