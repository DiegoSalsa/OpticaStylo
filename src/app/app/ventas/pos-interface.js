"use client";

import Link from "next/link";

import Icon from "@/components/ui/icon";
import Pagination from "@/components/internal/pagination";
import "@/components/internal/resource-directory.css";
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
    quotationList,
    quotationQuery,
    setQuotationQuery,
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
          <form className="directory-search" onSubmit={(event) => { event.preventDefault(); quotationList.setFilters({ search: quotationQuery.trim() }); }}>
            <input aria-label="Buscar cotizaciones" maxLength={100} placeholder="N.º de cotización o cliente" value={quotationQuery} onChange={(event) => setQuotationQuery(event.target.value)} />
            <button className="app-button" type="submit">Buscar</button>
          </form>
          {quotationList.status === "loading" ? (
            <p className="quotation-empty">Cargando cotizaciones…</p>
          ) : quotationList.status === "error" ? null : quotationList.items.length ? (
            <div className="quotation-list">
              {quotationList.items.map((quotation) => (
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
                    disabled={pending}
                    onClick={() => loadQuotation(quotation.id)}
                    type="button"
                  >
                    Cargar para vender
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="quotation-empty">{quotationList.filters.search ? "No hay cotizaciones coincidentes." : "No hay cotizaciones abiertas."}</p>
          )}
          <Pagination {...quotationList} label="cotizaciones" />
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
