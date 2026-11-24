import { randomUUID } from "node:crypto";
import { prisma } from "../../src/db/prisma.js";
import { ids, requireAcademicIsolation } from "./academic-data.js";

const modes = ["CASH", "TRANSBANK", "GETNET", "BANK_TRANSFER"];
const day = (date) => new Date("2025-01-" + date + "T12:00:00Z");

export const accountingFields = [
  "cashPaymentsCents", "electronicPaymentsCents", "receivedCents", "byMethod",
  "manualInCents", "manualOutCents", "withdrawalCents", "reversalCents",
  "paymentCount", "saleCount", "expectedAmountCents", "pending",
];

export function accountingFieldsOf(session) {
  return Object.fromEntries(accountingFields.map((field) => [field, session[field]]));
}

export async function seedCashPagination() {
  requireAcademicIsolation();
  const tag = randomUUID().slice(0, 8);
  const branch = (suffix) => ({
    id: randomUUID(), code: "CAJA-" + tag + "-" + suffix,
    name: "Caja sintética " + tag + " " + suffix, information_source: "Fixture sintético",
  });
  const main = branch("A"), remote = branch("B");
  const terminal = (label, location = main) => ({ id: randomUUID(), branch_id: location.id, name: label + " " + tag });
  const busyTerminal = terminal("Caja de volumen");
  const ownTerminal = terminal("Caja propia");
  const remoteTerminal = terminal("Caja ajena", remote);
  const session = (terminalRow, owner) => ({
    id: randomUUID(), opened_by: owner, branch_id: terminalRow.branch_id, terminal_id: terminalRow.id,
    opening_amount_cents: 30000, opened_at: day("01"),
  });
  const busy = session(busyTerminal, ids.admin);
  const own = session(ownTerminal, ids.sales);
  const other = session(remoteTerminal, ids.admin);

  const saleIds = Array.from({ length: 60 }, () => randomUUID());
  const pendingId = saleIds.at(-1);
  const payments = Array.from({ length: 120 }, (_, index) => ({
    id: randomUUID(), sale_id: saleIds[Math.floor(index / 2)], cash_session_id: busy.id,
    received_by: ids.admin, amount_cents: 100 + index, payment_method: modes[index % modes.length],
    reference: index % 4 === 0 ? null : "Comprobante sintético " + (index + 1), paid_at: day("15"),
    ...(index % 4 === 0 ? { cash_received_cents: 100 + index, change_cents: 0 } : {}),
  }));

  const movement = (type, amount, reason, when = day("15")) => ({
    id: randomUUID(), session_id: busy.id, movement_type: type, amount_cents: amount, reason,
    created_by: ids.admin, request_key: randomUUID(), created_at: when,
  });
  const originalTypes = ["MANUAL_IN", "MANUAL_OUT", "WITHDRAWAL"];
  const old = originalTypes.map((type, index) => movement(type, (index + 1) * 100, "Original sintético revertido " + type, day("02")));
  const oldWithdrawal = movement("WITHDRAWAL", 27, "Retiro antiguo para reversar", day("02"));
  const manual = [
    ...old, oldWithdrawal,
    ...Array.from({ length: 103 }, (_, index) => movement(originalTypes[index % 3], 20 + index, "Movimiento sintético " + index)),
  ];
  const reversed = old.map((row) => ({
    ...movement("REVERSAL", row.amount_cents, "Corrección sintética", day("22")), reversal_of: row.id,
  }));
  const movements = [...manual, ...reversed, ...payments.filter((p) => p.payment_method === "CASH").map((p) => ({
    ...movement("PAYMENT", p.amount_cents, "Cobro sintético", day("15")), payment_id: p.id,
  }))];

  const emptyAccounting = {
    cashPaymentsCents: 0, electronicPaymentsCents: 0, receivedCents: 0, byMethod: {},
    manualInCents: 0, manualOutCents: 0, withdrawalCents: 0, reversalCents: 0,
    paymentCount: 0, saleCount: 0, expectedAmountCents: 30000, pending: [],
  };
  const history = Array.from({ length: 60 }, () => ({
    ...session(busyTerminal, ids.admin), status: "CLOSED", opened_at: day("01"),
    closed_at: day("02"), closed_by: ids.admin, closing_counted_cents: 30000,
    expected_amount_cents: 30000, difference_cents: 0, closing_summary: emptyAccounting,
  }));

  await prisma.$transaction(async (client) => {
    await client.branches.createMany({ data: [main, remote] });
    await client.user_branches.create({ data: { branch_id: main.id, user_id: ids.sales } });
    await client.cash_register_terminals.createMany({ data: [busyTerminal, ownTerminal, remoteTerminal] });
    await client.cash_register_sessions.createMany({ data: [busy, own, other, ...history] });
    await client.sales.createMany({ data: saleIds.map((id, index) => {
      const subtotal = id === pendingId ? 1000 : payments[index * 2].amount_cents + payments[index * 2 + 1].amount_cents;
      return {
        id, cash_session_id: busy.id, branch_id: main.id, created_by: ids.admin, updated_by: ids.admin,
        status: id === pendingId ? "PENDING" : "PAID", subtotal_cents: subtotal, total_cents: subtotal,
      };
    }) });
    await client.sale_payments.createMany({ data: [...payments, {
      sale_id: pendingId, cash_session_id: own.id, received_by: ids.sales, amount_cents: 50,
      payment_method: "BANK_TRANSFER", reference: "Abono sintético de otro turno",
    }] });
    await client.cash_register_movements.createMany({ data: movements });
  });

  const byMethod = Object.fromEntries(modes.map((mode) => [
    mode, payments.filter((row) => row.payment_method === mode).reduce((sum, row) => sum + row.amount_cents, 0),
  ]));
  const totals = originalTypes.map((type) => manual.filter((row) => row.movement_type === type).reduce((sum, row) => sum + row.amount_cents, 0));
  const paymentTotal = payments.reduce((sum, row) => sum + row.amount_cents, 0);
  const pendingSale = await prisma.sales.findUniqueOrThrow({ where: { id: pendingId }, select: { sale_number: true } });
  const expected = {
    cashPaymentsCents: byMethod.CASH, electronicPaymentsCents: paymentTotal - byMethod.CASH, receivedCents: paymentTotal, byMethod,
    manualInCents: totals[0], manualOutCents: totals[1], withdrawalCents: totals[2], reversalCents: -100 + 200 + 300,
    paymentCount: payments.length, saleCount: saleIds.length,
    expectedAmountCents: busy.opening_amount_cents + byMethod.CASH + totals[0] - totals[1] - totals[2] - 100 + 200 + 300,
    pending: [{ id: pendingId, saleNumber: Number(pendingSale.sale_number), balanceCents: 1000 - 218 - 219 - 50 }],
  };
  const ordered = (rows, date) => [...rows].sort((a, b) => a[date] - b[date] || a.id.localeCompare(b.id)).map((row) => row.id);
  return {
    main, remote, busy, own, other, busyTerminal, old, oldWithdrawal, history, expected,
    paymentIds: ordered(payments, "paid_at"), movementIds: ordered(movements, "created_at"),
  };
}
