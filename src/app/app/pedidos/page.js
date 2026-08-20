"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import "./orders.css";

const money = new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" });
const columns = [
  { code: "PENDING", label: "Pendiente", tone: "amber" },
  { code: "PAID", label: "Pagado", tone: "aqua" },
  { code: "IN_PREPARATION", label: "En preparación", tone: "blue" },
  { code: "READY", label: "Listo", tone: "green" },
  { code: "DELIVERED", label: "Entregado", tone: "gray" },
];
const nextStatus = { PAID: "IN_PREPARATION", IN_PREPARATION: "READY", READY: "DELIVERED" };
const nextLabel = { PAID: "Iniciar preparación", IN_PREPARATION: "Marcar listo", READY: "Marcar entregado" };

export default function OrdersPage() {
  const actor = useInternalActor();
  const [sales, setSales] = useState([]);
  const [origin, setOrigin] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const allowed = actor?.permissions.includes("sales.read");
  const canUpdate = actor?.permissions.includes("sales.update");

  const load = useCallback(async (signal) => {
    const result = await readResponse(await fetch("/api/sales?page=1&pageSize=100", { cache: "no-store", signal }));
    setSales(result.items.filter((sale) => columns.some((column) => column.code === sale.status)));
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void load(controller.signal).catch((error) => { if (error.name !== "AbortError") { setNotice({ kind: "error", text: error.message }); setStatus("error"); } });
    }, 0);
    return () => { window.clearTimeout(timeoutId); controller.abort(); };
  }, [allowed, load]);

  const filtered = useMemo(() => sales.filter((sale) => {
    if (origin && sale.origin !== origin) return false;
    const text = `${sale.saleNumber} ${sale.customer.firstNames} ${sale.customer.lastNames} ${sale.customer.rut}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [origin, query, sales]);

  async function advance(sale) {
    const target = nextStatus[sale.status];
    if (!target) return;
    setStatus("saving"); setNotice(null);
    try {
      const saved = await readResponse(await fetch(`/api/sales/${sale.id}/status`, { body: JSON.stringify({ status: target }), headers: { "Content-Type": "application/json" }, method: "PATCH" }));
      setSales((items) => items.map((item) => item.id === saved.id ? saved : item));
      setNotice({ kind: "success", text: `Pedido N.º ${saved.saleNumber} actualizado correctamente.` });
    } catch (error) { setNotice({ kind: "error", text: error.message }); }
    finally { setStatus("ready"); }
  }

  if (actor && !allowed) return <section className="app-card empty-module"><h2>Acceso no disponible</h2><p>Este módulo requiere permiso para consultar ventas y pedidos.</p></section>;

  return <>
    <header className="app-heading"><div><p className="eyebrow">Operación</p><h1>Gestión de pedidos</h1><p>Seguimiento de ventas confirmadas desde el pago hasta la entrega.</p></div><span className="status-chip">{filtered.length} pedidos visibles</span></header>
    <section className="app-card orders-toolbar"><div className="orders-search"><Icon name="search" /><input aria-label="Buscar pedido" onChange={(event) => setQuery(event.target.value)} placeholder="N.º de venta, cliente o RUT" value={query} /></div><label className="field"><span>Origen</span><select onChange={(event) => setOrigin(event.target.value)} value={origin}><option value="">Todos</option><option value="ONLINE">Tienda web</option><option value="IN_STORE">Mostrador</option></select></label><button className="app-button app-button--soft" disabled={status === "loading"} onClick={() => { setStatus("loading"); void load(); }} type="button">Actualizar</button></section>
    {notice && <p className={notice.kind === "error" ? "inline-error" : "inline-success"}>{notice.text}</p>}
    <section className="orders-board" aria-busy={status === "loading"}>{columns.map((column) => { const items = filtered.filter((sale) => sale.status === column.code); return <div className="order-column" data-tone={column.tone} key={column.code}><header><span /><h2>{column.label}</h2><b>{items.length}</b></header><div className="order-column-body">{items.length === 0 ? <p className="order-column-empty">Sin pedidos</p> : items.map((sale) => <article className="order-card" key={sale.id}><div className="order-card-top"><span>Pedido N.º {sale.saleNumber}</span><small>{sale.origin === "ONLINE" ? "WEB" : "POS"}</small></div><h3>{sale.customer.firstNames} {sale.customer.lastNames}</h3><p>{sale.customer.rut} · {new Date(sale.createdAt).toLocaleDateString("es-CL")}</p><dl><div><dt>Total</dt><dd>{money.format(sale.totalCents)}</dd></div>{sale.balanceCents > 0 && <div><dt>Saldo</dt><dd>{money.format(sale.balanceCents)}</dd></div>}</dl>{sale.fulfillment && <div className="order-fulfillment"><Icon name={sale.fulfillment.method === "PICKUP" ? "home" : "package"} size={15} /><span>{sale.fulfillment.method === "PICKUP" ? "Retiro en tienda" : "Despacho"}</span></div>}{nextStatus[sale.status] && canUpdate && <button className="order-advance" disabled={status === "saving"} onClick={() => advance(sale)} type="button">{nextLabel[sale.status]} <Icon name="arrow" size={15} /></button>}</article>)}</div></div>; })}</section>
    <p className="orders-footnote"><Icon name="shield" size={15} /> El módulo no ejecuta reembolsos. Los pedidos pendientes solo avanzan después de registrar el pago por el flujo autorizado.</p>
  </>;
}
