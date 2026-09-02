"use client";

import Link from "next/link";

import Icon from "@/components/ui/icon";
import CashRegisterPanel from "./cash-register-panel";
import PosCatalogPanel from "./pos-catalog-panel";
import PosTicketPanel from "./pos-ticket-panel";

export default function PosInterface({ model }) {
  const {
    canSell,
    loadQuotation,
    loadQuotations,
    money,
    pending,
    quotations,
    reset,
    setCashRegister,
    setShowQuotations,
    showQuotations,
  } = model;

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Mostrador</p>
          <h1>Ventas y cotizaciones</h1>
          <p>Venta comercial, clara y sin tareas clínicas o de agenda.</p>
        </div>
        <div className="pos-heading-actions">
          <Link className="app-button app-button--soft" href="/app/reportes">
            <Icon name="chart" size={16} /> Reportes
          </Link>
          <button
            className="app-button app-button--soft"
            disabled={pending}
            onClick={loadQuotations}
            type="button"
          >
            <Icon name="file" size={16} /> Cotizaciones
          </button>
          <button
            className="app-button app-button--primary"
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nueva venta
          </button>
        </div>
      </header>
      {!canSell && (
        <p className="inline-error">
          Tu cuenta no tiene permiso para registrar ventas.
        </p>
      )}
      {showQuotations && (
        <section className="app-card quotation-panel">
          <div className="quotation-heading">
            <div>
              <p className="eyebrow">Seguimiento comercial</p>
              <h2>Cotizaciones abiertas</h2>
            </div>
            <button
              className="text-button"
              onClick={() => setShowQuotations(false)}
              type="button"
            >
              Cerrar
            </button>
          </div>
          {pending ? (
            <p className="quotation-empty">Cargando cotizaciones…</p>
          ) : quotations.length ? (
            <div className="quotation-list">
              {quotations.map((quotation) => (
                <article key={quotation.id}>
                  <div>
                    <strong>Cotización N.º {quotation.saleNumber}</strong>
                    <small>
                      {quotation.customer
                        ? `${quotation.customer.firstNames} ${quotation.customer.lastNames}`
                        : "Venta de solo marco sin cliente registrado"}
                      {quotation.quotationValidUntil
                        ? ` · válida hasta ${new Date(quotation.quotationValidUntil).toLocaleDateString("es-CL")}`
                        : ""}
                    </small>
                  </div>
                  <b>{money.format(quotation.totalCents)}</b>
                  <button
                    className="app-button app-button--primary"
                    onClick={() => loadQuotation(quotation.id)}
                    type="button"
                  >
                    Cargar para vender
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="quotation-empty">No hay cotizaciones abiertas.</p>
          )}
        </section>
      )}
      {canSell && <CashRegisterPanel onChange={setCashRegister} />}
      <div className="pos-layout">
        <PosCatalogPanel model={model} />
        <PosTicketPanel model={model} />
      </div>
    </>
  );
}
