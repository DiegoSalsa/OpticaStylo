"use client";

import { useEffect, useState } from "react";

import { readResponse } from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";

const money = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});

export default function CashRegisterPanel({ onChange }) {
  const [cashRegister, setCashRegister] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function refresh() {
    try {
      const current = await readResponse(await fetch("/api/cash-register", { cache: "no-store" }));
      setCashRegister(current);
      onChange?.(current);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/cash-register", { cache: "no-store" })
      .then((response) => readResponse(response))
      .then((current) => {
        if (!active) return;
        setCashRegister(current);
        onChange?.(current);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => { active = false; };
  }, [onChange]);

  async function request(url, body) {
    setPending(true);
    setError("");
    try {
      const session = await readResponse(await fetch(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }));
      setCashRegister(session);
      onChange?.(session);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  function open(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    request("/api/cash-register", {
      openingAmountCents: Number(form.get("openingAmountCents")),
      openingNotes: form.get("openingNotes") || null,
    });
  }

  function movement(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    request(`/api/cash-register/${cashRegister.id}/movements`, {
      amountCents: Number(form.get("amountCents")),
      movementType: form.get("movementType"),
      reason: form.get("reason"),
    });
    event.currentTarget.reset();
  }

  function close(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    request(`/api/cash-register/${cashRegister.id}/close`, {
      closingCountedCents: Number(form.get("closingCountedCents")),
      closingNotes: form.get("closingNotes") || null,
    });
  }

  return (
    <section className="app-card cash-register-panel" aria-labelledby="cash-register-title">
      <div className="cash-register-heading">
        <div>
          <p className="eyebrow">Caja de pruebas</p>
          <h2 id="cash-register-title">Apertura, movimientos y arqueo</h2>
          <p>Configuración temporal sin local asignado ni integración de impresora física.</p>
        </div>
        <button className="text-button" onClick={refresh} type="button">Actualizar</button>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!cashRegister ? (
        <form className="cash-register-form" onSubmit={open}>
          <label className="field"><span>Fondo inicial de prueba</span><input min="0" name="openingAmountCents" required type="number" /></label>
          <label className="field"><span>Observación</span><input maxLength="500" name="openingNotes" /></label>
          <button className="app-button app-button--primary" disabled={pending} type="submit"><Icon name="plus" size={16} /> Abrir caja</button>
        </form>
      ) : (
        <div className="cash-register-content">
          <dl className="cash-register-summary">
            <div><dt>Fondo inicial</dt><dd>{money.format(cashRegister.openingAmountCents)}</dd></div>
            <div><dt>Efectivo vendido</dt><dd>{money.format(cashRegister.cashPaymentsCents)}</dd></div>
            <div><dt>Esperado</dt><dd>{money.format(cashRegister.expectedAmountCents)}</dd></div>
          </dl>
          {cashRegister.status === "CLOSED" ? (
            <div className="cash-register-closed">
              <p>Caja cerrada. Arqueo: {money.format(cashRegister.closingCountedCents)}. Diferencia: {money.format(cashRegister.differenceCents)}.</p>
              <button
                className="app-button app-button--soft"
                onClick={() => { setCashRegister(null); onChange?.(null); }}
                type="button"
              >Abrir otra caja de prueba</button>
            </div>
          ) : <>
            <form className="cash-register-form" onSubmit={movement}>
              <label className="field"><span>Movimiento</span><select defaultValue="MANUAL_IN" name="movementType"><option value="MANUAL_IN">Ingreso manual</option><option value="MANUAL_OUT">Egreso manual</option></select></label>
              <label className="field"><span>Monto</span><input min="1" name="amountCents" required type="number" /></label>
              <label className="field"><span>Motivo</span><input maxLength="500" name="reason" required /></label>
              <button className="app-button app-button--soft" disabled={pending} type="submit">Registrar movimiento</button>
            </form>
            <form className="cash-register-form cash-register-close" onSubmit={close}>
              <label className="field"><span>Arqueo contado</span><input min="0" name="closingCountedCents" required type="number" /></label>
              <label className="field"><span>Observación de cierre</span><input maxLength="500" name="closingNotes" /></label>
              <button className="app-button app-button--primary" disabled={pending} type="submit">Cerrar caja</button>
            </form>
          </>}
        </div>
      )}
    </section>
  );
}
