"use client";

import { useEffect, useRef, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import Pagination from "@/components/internal/pagination";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import Icon from "@/components/ui/icon";
import OrderDetail from "./order-detail";
import "./orders.css";

const money = new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" });
const columns = [
  { code: "PENDING", label: "Pendiente", tone: "amber" },
  { code: "PAID", label: "Pagado", tone: "aqua" },
  { code: "IN_PREPARATION", label: "En preparación", tone: "blue" },
  { code: "READY", label: "Listo", tone: "green" },
  { code: "DELIVERED", label: "Entregado", tone: "gray" },
  { code: "CANCELLED", label: "Cancelado", tone: "gray" },
];
const nextStatus = { PAID: "IN_PREPARATION", IN_PREPARATION: "READY", READY: "DELIVERED" };
const nextLabel = { PAID: "Iniciar preparación", IN_PREPARATION: "Marcar listo", READY: "Marcar entregado" };
function customerLabel(sale) { return sale.customer ? [sale.customer.firstNames, sale.customer.lastNames].filter(Boolean).join(" ") : "Sin cliente registrado"; }
function inView(column, view) { return view === "active" ? ["PENDING", "PAID", "IN_PREPARATION", "READY"].includes(column.code) : view === "delivered" ? column.code === "DELIVERED" : true; }

function OrderColumn({ column, endpoint, refresh, canUpdate, pendingIds, advance, showDetail, hasFilters }) {
  const list = usePaginatedResource(`${endpoint}&status=${column.code}`, { reloadKey: refresh });
  return <section className="order-column" data-tone={column.tone} aria-label={column.label} aria-busy={list.status === "loading"}>
    <header><span /><h2>{column.label}</h2><b aria-label={`Total ${column.label}`}>{list.status === "ready" ? list.total : "—"}</b></header>
    <div className="order-column-body">
      {list.status === "ready" && !list.items.length && <p className="order-column-empty">{hasFilters ? "Sin coincidencias" : "Sin pedidos"}</p>}
      {list.items.map((sale) => <article className="order-card" key={sale.id}>
        <div className="order-card-top"><span>Pedido N.º {sale.saleNumber}</span><small>{sale.origin === "ONLINE" ? "WEB" : "POS"}</small></div>
        <h3>{customerLabel(sale)}</h3><p>{sale.customer?.rut ?? "Sin RUT"} · {new Date(sale.createdAt).toLocaleDateString("es-CL")}</p>
        <dl><div><dt>Total</dt><dd>{money.format(sale.totalCents)}</dd></div>{sale.balanceCents > 0 && <div><dt>Saldo</dt><dd>{money.format(sale.balanceCents)}</dd></div>}</dl>
        {sale.fulfillment && <div className="order-fulfillment"><Icon name={sale.fulfillment.method === "PICKUP" ? "home" : "package"} size={15} /><span>{sale.fulfillment.method === "PICKUP" ? "Retiro en tienda" : "Despacho"}</span></div>}
        <button className="order-detail-button" onClick={() => showDetail(sale.id)} type="button">Ver detalle</button>
        {nextStatus[sale.status] && canUpdate && <button className="order-advance" disabled={pendingIds.includes(sale.id)} onClick={() => advance(sale)} type="button">{pendingIds.includes(sale.id) ? "Procesando…" : nextLabel[sale.status]} <Icon name="arrow" size={15} /></button>}
      </article>)}
    </div>
    <Pagination {...list} label={`pedidos ${column.label.toLowerCase()}`} />
  </section>;
}

export default function OrdersBoard() {
  const actor = useInternalActor();
  const [filters, setFilters] = useState({ origin: "", search: "", status: "", view: "active" });
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [summary, setSummary] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pendingIds, setPendingIds] = useState([]);
  const [detailId, setDetailId] = useState(null);
  const mutations = useRef(new Set());
  const allowed = actor?.permissions.includes("sales.read");
  const canUpdate = actor?.permissions.includes("sales.update");
  const params = new URLSearchParams(Object.entries(filters).filter(([,value]) => value));
  const filterKey = params.toString();
  const summaryKey = `${filterKey}:${refresh}`;

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await readResponse(await fetch(`/api/sales/summary?${filterKey}`, { cache: "no-store", signal: controller.signal }));
        if (!controller.signal.aborted) setSummary({ data, key: summaryKey });
      } catch (error) {
        if (!controller.signal.aborted) setSummary({ error: error.message, key: summaryKey });
      }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [allowed, filterKey, summaryKey]);

  async function advance(sale) {
    const target = nextStatus[sale.status];
    if (!canUpdate || !target || mutations.current.has(sale.id)) return;
    mutations.current.add(sale.id);
    setPendingIds([...mutations.current]);
    setNotice(null);
    try {
      const saved = await readResponse(await fetch(`/api/sales/${sale.id}/status`, { body: JSON.stringify({ status: target }), headers: { "Content-Type": "application/json" }, method: "PATCH" }));
      setNotice({ kind: "success", text: `Pedido N.º ${saved.saleNumber} actualizado correctamente.` });
    } catch (error) { setNotice({ kind: "error", text: error.message }); }
    finally {
      mutations.current.delete(sale.id);
      setPendingIds([...mutations.current]);
      // Refresh even on rejection: another operator may have moved this order.
      setRefresh((value) => value + 1);
    }
  }
  if (actor && !allowed) return <section className="app-card empty-module"><h2>Acceso no disponible</h2><p>Este módulo requiere permiso para consultar ventas y pedidos.</p></section>;

  const viewColumns = columns.filter((column) => inView(column, filters.view));
  const visibleColumns = viewColumns.filter((column) => !filters.status || filters.status === column.code);
  const currentSummary = summary?.key === summaryKey ? summary : null;
  return <>
    <header className="app-heading"><div><p className="eyebrow">Operación</p><h1>Gestión de pedidos</h1><p>Seguimiento de ventas confirmadas desde el pago hasta la entrega.</p></div><span className="status-chip" role="status">{currentSummary?.data ? `${currentSummary.data.total} pedidos encontrados` : currentSummary?.error ? "Conteo no disponible" : "Cargando conteo…"}</span></header>
    <div className="orders-views" role="group" aria-label="Vista de pedidos">{[["active","Pedidos activos"],["delivered","Pedidos entregados"],["history","Historial completo"]].map(([view,label]) => <button className="app-button" aria-pressed={filters.view === view} key={view} onClick={() => setFilters((current) => ({ ...current, status: "", view }))} type="button">{label}</button>)}</div>
    <section className="app-card orders-toolbar">
      <form className="orders-search" onSubmit={(event) => { event.preventDefault(); setFilters((current) => ({ ...current, search: query.trim() })); }}><Icon name="search" /><input aria-label="Buscar pedido" maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="N.º de venta, cliente o RUT" value={query} /><button className="app-button" type="submit">Buscar</button></form>
      <label className="field"><span>Origen</span><select onChange={(event) => setFilters((current) => ({ ...current, origin: event.target.value }))} value={filters.origin}><option value="">Todos</option><option value="ONLINE">WEB</option><option value="IN_STORE">POS</option></select></label>
      <label className="field"><span>Estado operativo</span><select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}><option value="">Todos</option>{viewColumns.map((column) => <option key={column.code} value={column.code}>{column.label}</option>)}</select></label>
      <button className="app-button app-button--soft" disabled={!currentSummary} onClick={() => setRefresh((value) => value + 1)} type="button">Actualizar</button>
    </section>
    {currentSummary?.error && <p className="inline-error" role="alert">No se pudo consultar el conteo: {currentSummary.error}</p>}
    {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "inline-error" : "inline-success"}>{notice.text}</p>}
    <section className="orders-board" style={{ "--order-count": visibleColumns.length }}>{allowed && visibleColumns.map((column) => <OrderColumn key={`${column.code}:${filterKey}`} column={column} endpoint={`/api/sales?${filterKey}`} refresh={refresh} canUpdate={canUpdate} pendingIds={pendingIds} advance={advance} showDetail={setDetailId} hasFilters={Boolean(filters.search || filters.origin)} />)}</section>
    {detailId && <OrderDetail key={detailId} saleId={detailId} onClose={() => setDetailId(null)} />}
    <p className="orders-footnote"><Icon name="shield" size={15} /> Los pedidos pendientes solo avanzan después de registrar el pago por el flujo autorizado.</p>
  </>;
}
