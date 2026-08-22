"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import "./reports.css";

const money = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});
const STATUS = {
  CANCELLED: "Canceladas",
  DELIVERED: "Entregadas",
  IN_PREPARATION: "En preparación",
  PAID: "Pagadas",
  PENDING: "Pendientes",
  QUOTATION: "Cotizaciones",
  READY: "Listas",
};
const PAYMENT = {
  BANK_TRANSFER: "Transferencia",
  CASH: "Efectivo",
  GETNET: "Getnet",
  MERCADO_PAGO: "Mercado Pago",
  TRANSBANK: "Transbank",
};
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(
    new Date(),
  );
const monthAgo = () => {
  const value = new Date();
  value.setDate(value.getDate() - 29);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago",
  }).format(value);
};

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function exportCsv(data) {
  const rows = [
    ["Producto", "SKU", "Unidades", "Venta bruta CLP"],
    ...data.products.map((item) => [
      item.productName,
      item.productSku,
      item.units,
      item.grossCents,
    ]),
  ];
  const blob = new Blob(
    [`\ufeff${rows.map((row) => row.map(csvValue).join(";")).join("\r\n")}`],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-ventas-${data.filters.from}-${data.filters.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const actor = useInternalActor();
  const [filters, setFilters] = useState({
    from: monthAgo(),
    origin: "",
    status: "",
    to: today(),
  });
  const [applied, setApplied] = useState(filters);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const allowed = actor?.permissions.some((permission) =>
    ["reports.read", "sales.reports_read"].includes(permission),
  );
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const params = new URLSearchParams(
      Object.entries(applied).filter(([, value]) => value),
    );
    fetch(`/api/reports/sales?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readResponse)
      .then((result) => {
        setData(result);
        setStatus("ready");
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [allowed, applied]);
  const maximumDaily = useMemo(
    () => Math.max(1, ...(data?.daily.map((item) => item.totalCents) ?? [1])),
    [data],
  );
  if (actor && !allowed)
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>Tu cuenta no tiene permiso para consultar reportes comerciales.</p>
      </section>
    );
  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Análisis comercial</p>
          <h1>Reportes y analítica</h1>
          <p>Datos agregados directamente desde las operaciones registradas.</p>
        </div>
        {data && (
          <button
            className="app-button app-button--soft"
            onClick={() => exportCsv(data)}
            type="button"
          >
            <Icon name="arrow" size={16} /> Exportar productos CSV
          </button>
        )}
      </header>
      <form
        className="app-card report-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setStatus("loading");
          setApplied(filters);
        }}
      >
        <label className="field">
          <span>Desde</span>
          <input
            onChange={(event) =>
              setFilters({ ...filters, from: event.target.value })
            }
            required
            type="date"
            value={filters.from}
          />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input
            min={filters.from}
            onChange={(event) =>
              setFilters({ ...filters, to: event.target.value })
            }
            required
            type="date"
            value={filters.to}
          />
        </label>
        <label className="field">
          <span>Estado</span>
          <select
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value })
            }
            value={filters.status}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Origen</span>
          <select
            onChange={(event) =>
              setFilters({ ...filters, origin: event.target.value })
            }
            value={filters.origin}
          >
            <option value="">Todos</option>
            <option value="IN_STORE">Mostrador</option>
            <option value="ONLINE">Tienda web</option>
          </select>
        </label>
        <button className="app-button app-button--primary" type="submit">
          Aplicar
        </button>
      </form>
      {error && <p className="inline-error">{error}</p>}
      {status === "loading" ? (
        <section className="app-card empty-module">
          <p>Cargando métricas…</p>
        </section>
      ) : (
        data && (
          <>
            <section className="report-metrics">
              <article className="app-card report-metric">
                <small>Operaciones</small>
                <strong>{data.summary.operationCount}</strong>
                <span>
                  {data.summary.cancelledCount} canceladas dentro del filtro
                </span>
              </article>
              <article className="app-card report-metric">
                <small>Total comercial</small>
                <strong>{money.format(data.summary.totalCents)}</strong>
                <span>Excluye ventas canceladas</span>
              </article>
              <article className="app-card report-metric">
                <small>Pagos registrados</small>
                <strong>{money.format(data.summary.paidCents)}</strong>
                <span>Incluye abonos</span>
              </article>
              <article className="app-card report-metric">
                <small>Saldo pendiente</small>
                <strong>{money.format(data.summary.balanceCents)}</strong>
                <span>De operaciones no canceladas</span>
              </article>
              <article className="app-card report-metric">
                <small>Descuentos</small>
                <strong>{money.format(data.summary.discountCents)}</strong>
                <span>Motivos disponibles en historial</span>
              </article>
            </section>
            <section className="report-columns">
              <article className="app-card report-card">
                <h2>Evolución diaria</h2>
                {!data.daily.length ? (
                  <p className="directory-state">
                    Sin operaciones para graficar.
                  </p>
                ) : (
                  <div className="report-bars">
                    {data.daily.map((item) => (
                      <div key={item.day}>
                        <div className="report-bar-label">
                          <span>
                            {new Date(
                              `${item.day}T12:00:00Z`,
                            ).toLocaleDateString("es-CL")}
                          </span>
                          <strong>
                            {money.format(item.totalCents)} · {item.count}
                          </strong>
                        </div>
                        <div className="report-bar-track">
                          <i
                            style={{
                              width: `${Math.max(1, (item.totalCents / maximumDaily) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <article className="app-card report-card">
                <h2>Estados</h2>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Estado</th>
                      <th>Operaciones</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.statuses.map((item) => (
                      <tr key={item.status}>
                        <td>{STATUS[item.status] ?? item.status}</td>
                        <td>{item.count}</td>
                        <td>{money.format(item.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
              <article className="app-card report-card">
                <h2>Medios de pago</h2>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Medio</th>
                      <th>Abonos</th>
                      <th>Pagado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.paymentMethods.map((item) => (
                      <tr key={item.paymentMethod}>
                        <td>
                          {PAYMENT[item.paymentMethod] ?? item.paymentMethod}
                        </td>
                        <td>{item.paymentCount}</td>
                        <td>{money.format(item.paidCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
              <article className="app-card report-card">
                <h2>Productos vendidos</h2>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Unidades</th>
                      <th>Bruto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((item) => (
                      <tr key={item.productId}>
                        <td>
                          {item.productName}
                          <br />
                          <small>{item.productSku}</small>
                        </td>
                        <td>{item.units}</td>
                        <td>{money.format(item.grossCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            </section>
            <p className="inline-success report-note">
              No se muestran stock, rotación ni quiebres: esas métricas dependen
              del software de inventario de la etapa 6.
            </p>
          </>
        )
      )}
    </>
  );
}
