"use client";

import Icon from "@/components/ui/icon";
import { PAYMENT_METHODS } from "./pos-form-model";

export default function PosPaymentPanel({ model }) {
  const {
    cashReceivedCents,
    cashRegister,
    customer,
    issueCurrentReceipt,
    money,
    paymentMethod,
    pending,
    receipt,
    registerPayment,
    reset,
    sale,
    setCashReceivedCents,
    setPaymentMethod,
  } = model;

  return (
    <>
      {sale?.payments?.length > 0 && (
        <section
          className="payment-history"
          aria-labelledby="payment-history-title"
        >
          <h3 id="payment-history-title">Historial de abonos</h3>
          <ul>
            {sale.payments.map((payment, index) => (
              <li key={payment.id}>
                <span>
                  <strong>Abono {index + 1}</strong>
                  <small>{money.format(payment.amountCents)}</small>
                </span>
                {payment.receipt ? (
                  <a
                    href={`/api/sales/${sale.id}/receipt/print?receiptId=${payment.receipt.id}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Comprobante N.º {payment.receipt.receiptNumber}
                  </a>
                ) : (
                  <small>Comprobante pendiente</small>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {sale?.status === "PENDING" && (
        <>
          <form className="payment-form" onSubmit={registerPayment}>
            <h3>Registrar abono manual</h3>
            <label className="field">
              <span>Monto (máx. {money.format(sale.balanceCents)})</span>
              <input
                defaultValue={sale.balanceCents}
                max={sale.balanceCents}
                min="1"
                name="amountCents"
                required
                type="number"
              />
            </label>
            <label className="field">
              <span>Medio único para esta venta</span>
              {sale.paymentMethod ? (
                <>
                  <input
                    readOnly
                    value={
                      PAYMENT_METHODS.find(
                        ([value]) => value === sale.paymentMethod,
                      )?.[1] ?? sale.paymentMethod
                    }
                  />
                  <input
                    name="paymentMethod"
                    type="hidden"
                    value={sale.paymentMethod}
                  />
                </>
              ) : (
                <select
                  name="paymentMethod"
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  required
                  value={paymentMethod}
                >
                  <option disabled value="">
                    Seleccionar
                  </option>
                  {PAYMENT_METHODS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {(sale.paymentMethod ?? paymentMethod) === "CASH" && (
              <label className="field">
                <span>Monto recibido</span>
                <input
                  min="1"
                  name="cashReceivedCents"
                  onChange={(event) => setCashReceivedCents(event.target.value)}
                  required
                  type="number"
                  value={cashReceivedCents}
                />
                <small>
                  Vuelto estimado:{" "}
                  {money.format(
                    Math.max(
                      0,
                      Number(cashReceivedCents || 0) -
                        Math.min(
                          Number(cashReceivedCents || 0),
                          sale.balanceCents,
                        ),
                    ),
                  )}
                </small>
                {!cashRegister && (
                  <small className="inline-error">
                    Abre la caja de prueba antes de registrar efectivo.
                  </small>
                )}
              </label>
            )}
            {["BANK_TRANSFER", "TRANSBANK", "GETNET"].includes(
              sale.paymentMethod ?? paymentMethod,
            ) && (
              <label className="field">
                <span>Referencia o folio obligatorio</span>
                <input maxLength="200" name="reference" required />
              </label>
            )}
            <label className="field">
              <span>Enviar comprobante a (opcional)</span>
              <input
                defaultValue={customer?.email ?? ""}
                name="email"
                type="email"
              />
            </label>
            <button
              className="app-button app-button--primary"
              disabled={
                pending ||
                ((sale.paymentMethod ?? paymentMethod) === "CASH" &&
                  !cashRegister)
              }
              type="submit"
            >
              Registrar abono
            </button>
          </form>
          <section
            className="mercado-pago-panel"
            aria-labelledby="mercado-pago-title"
          >
            <div>
              <h3 id="mercado-pago-title">Mercado Pago presencial</h3>
              <p>
                El checkout web se reserva para la tienda. Este POS habilitará
                cobro por Point o QR cuando la cuenta comercial y su caja estén
                vinculadas.
              </p>
            </div>
            <span className="status-chip status-chip--pending">
              Pendiente de configuración comercial
            </span>
          </section>
        </>
      )}
      {receipt && (
        <div className="receipt-result">
          <span className="status-chip">
            Comprobante N.º {receipt.receiptNumber}
          </span>
          <small>
            {receipt.type === "PAYMENT"
              ? "Abono registrado. "
              : "Pago final registrado. "}
            {receipt.emailStatus === "SENT"
              ? `Enviado a ${receipt.emailedTo}`
              : receipt.emailStatus === "SIMULATED"
                ? "Envío simulado; configura Resend para correo real."
                : "Comprobante emitido; revisa el estado del correo."}
          </small>
          <a
            className="app-button app-button--soft"
            href={`/api/sales/${sale.id}/receipt/print?receiptId=${receipt.id}`}
            rel="noreferrer"
            target="_blank"
          >
            <Icon name="receipt" size={16} /> Abrir comprobante
          </a>
        </div>
      )}
      {sale?.status === "PAID" && (
        <div className="completed-actions">
          {!receipt && (
            <button
              className="app-button app-button--soft ticket-action"
              disabled={pending}
              onClick={issueCurrentReceipt}
              type="button"
            >
              <Icon name="receipt" size={16} /> Emitir comprobante
            </button>
          )}
          <button
            className="app-button app-button--primary ticket-action"
            onClick={reset}
            type="button"
          >
            Finalizar y crear otra venta
          </button>
        </div>
      )}
    </>
  );
}
