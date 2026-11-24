import { inventoryError } from "./inventory-repository.js";

export function cashInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    inventoryError("CASH_AMOUNT_OUT_OF_RANGE", "El importe o identificador de Caja excede el rango exacto de la respuesta.");
  }
  return number;
}

export async function summarizeCashSession(client, row) {
  const [{ payment, movement, pending }] = await client.$queryRaw`
    WITH payment_methods AS (
      SELECT payment_method, SUM(amount_cents)::text AS amount
      FROM sale_payments
      WHERE cash_session_id = ${row.id}::uuid
      GROUP BY payment_method
    ), payment_totals AS (
      SELECT COUNT(*)::text AS "paymentCount", COUNT(DISTINCT sale_id)::text AS "saleCount",
        COALESCE(SUM(amount_cents), 0)::text AS received
      FROM sale_payments WHERE cash_session_id = ${row.id}::uuid
    ), movement_totals AS (
      SELECT
        COALESCE(SUM(m.amount_cents) FILTER (WHERE m.movement_type = 'MANUAL_IN'), 0)::text AS "manualIn",
        COALESCE(SUM(m.amount_cents) FILTER (WHERE m.movement_type = 'MANUAL_OUT'), 0)::text AS "manualOut",
        COALESCE(SUM(m.amount_cents) FILTER (WHERE m.movement_type = 'WITHDRAWAL'), 0)::text AS withdrawal,
        COALESCE(SUM(CASE WHEN original.movement_type = 'MANUAL_IN' THEN -m.amount_cents ELSE m.amount_cents END)
          FILTER (WHERE m.movement_type = 'REVERSAL'), 0)::text AS reversal
      FROM cash_register_movements m
      LEFT JOIN cash_register_movements original ON original.id = m.reversal_of
      WHERE m.session_id = ${row.id}::uuid
    )
    SELECT to_jsonb(payment_totals) || jsonb_build_object(
        'byMethod', COALESCE((SELECT jsonb_object_agg(payment_method, amount) FROM payment_methods), '{}'::jsonb)
      ) AS payment,
      to_jsonb(movement_totals) AS movement,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id, 'saleNumber', s.sale_number::text, 'balanceCents', (s.total_cents - paid.amount)::text
        ) ORDER BY s.sale_number, s.id)
        FROM sales s
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(p.amount_cents), 0) AS amount FROM sale_payments p WHERE p.sale_id = s.id
        ) paid
        WHERE s.cash_session_id = ${row.id}::uuid AND s.status = 'PENDING'
      ), '[]'::jsonb) AS pending
    FROM payment_totals CROSS JOIN movement_totals
  `;

  const cash = BigInt(payment.byMethod.CASH ?? 0);
  const received = BigInt(payment.received);
  const manualIn = BigInt(movement.manualIn);
  const manualOut = BigInt(movement.manualOut);
  const withdrawal = BigInt(movement.withdrawal);
  const reversal = BigInt(movement.reversal);
  return {
    byMethod: Object.fromEntries(Object.entries(payment.byMethod).map(([method, amount]) => [method, cashInteger(amount)])),
    cashPaymentsCents: cashInteger(cash),
    electronicPaymentsCents: cashInteger(received - cash),
    receivedCents: cashInteger(received),
    manualInCents: cashInteger(manualIn),
    manualOutCents: cashInteger(manualOut),
    withdrawalCents: cashInteger(withdrawal),
    reversalCents: cashInteger(reversal),
    paymentCount: cashInteger(payment.paymentCount),
    saleCount: cashInteger(payment.saleCount),
    expectedAmountCents: cashInteger(row.opening_amount_cents + cash + manualIn - manualOut - withdrawal + reversal),
    pending: pending.map(({ id, saleNumber, balanceCents }) => ({
      id, saleNumber: cashInteger(saleNumber), balanceCents: cashInteger(balanceCents),
    })),
  };
}
