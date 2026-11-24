"use client";

import { useState } from "react";
import Pagination from "@/components/internal/pagination";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import { MONEY_FORMATTER as money, PAYMENT_METHODS } from "./pos-form-model";

export const CASH_MOVEMENT_LABELS = {
  MANUAL_IN: "Ingreso extraordinario",
  MANUAL_OUT: "Egreso extraordinario",
  WITHDRAWAL: "Retiro parcial",
  PAYMENT: "Cobro en efectivo",
  REVERSAL: "Reverso autorizado",
};

const reversibleTypes = ["MANUAL_IN", "MANUAL_OUT", "WITHDRAWAL"];

export default function CashRegisterLedgers({ session, canAdjust, busy, onReverse, revision }) {
  const [expanded, setExpanded] = useState(false);
  const prefix = "/api/cash-register/" + session.id;
  const movements = usePaginatedResource(prefix + "/movements", { enabled: expanded, reloadKey: revision });
  const payments = usePaginatedResource(prefix + "/payments", { enabled: expanded, reloadKey: revision });

  return (
    <details className="cash-section" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>Movimientos y pagos de esta sesión</summary>
      <div role="region" aria-label="Libro de movimientos">
        {movements.status === "ready" && movements.items.length === 0 && <p>Sin movimientos registrados.</p>}
        {movements.items.length > 0 && (
          <div className="cash-ledger">
            <table>
              <caption>Movimientos de efectivo</caption>
              <thead><tr><th>Fecha</th><th>Tipo / operación</th><th>Importe</th><th>Motivo / responsable</th><th>Corrección</th></tr></thead>
              <tbody>{movements.items.map((movement) => (
                <tr key={movement.id}>
                  <td>{new Date(movement.createdAt).toLocaleString("es-CL")}</td>
                  <td>{CASH_MOVEMENT_LABELS[movement.movementType]}<small>{movement.operationId}</small></td>
                  <td>{money.format(movement.amountCents)}</td>
                  <td>{movement.reason}<small>{movement.actor}</small></td>
                  <td>
                    {movement.reversed ? "Reversado" : session.status === "OPEN" && canAdjust && reversibleTypes.includes(movement.movementType)
                      ? <Reversal movement={movement} disabled={busy} onReverse={onReverse} /> : "—"}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination {...movements} label="movimientos de caja" />
      </div>
      <div role="region" aria-label="Libro de pagos">
        {payments.status === "ready" && payments.items.length === 0 && <p>Sin pagos registrados.</p>}
        {payments.items.length > 0 && (
          <div className="cash-ledger">
            <table>
              <caption>Cobros acreditados en la sesión</caption>
              <thead><tr><th>Venta</th><th>Medio</th><th>Importe</th><th>Referencia</th></tr></thead>
              <tbody>{payments.items.map((payment) => (
                <tr key={payment.id}>
                  <td>N.º {payment.saleNumber}</td>
                  <td>{PAYMENT_METHODS.find(([method]) => method === payment.paymentMethod)?.[1] ?? payment.paymentMethod}</td>
                  <td>{money.format(payment.amountCents)}</td>
                  <td>{payment.reference ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination {...payments} label="pagos de caja" />
      </div>
    </details>
  );
}

function Reversal({ movement, disabled, onReverse }) {
  const [reason, setReason] = useState("");

  return (
    <details>
      <summary>Reversar</summary>
      <form onSubmit={(event) => { event.preventDefault(); onReverse(movement.id, reason); }}>
        <label className="field">
          <span>Motivo del reverso de {movement.id}</span>
          <input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button className="app-button" disabled={disabled}>Confirmar reverso</button>
      </form>
    </details>
  );
}
