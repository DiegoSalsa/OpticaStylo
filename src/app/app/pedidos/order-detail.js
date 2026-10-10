"use client";

import { useEffect, useRef, useState } from "react";
import { readResponse } from "@/components/internal/internal-shell";

const money = new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" });
const labels = { PENDING: "Pendiente", PAID: "Pagado", IN_PREPARATION: "En preparación", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Cancelado", QUOTATION: "Cotización" };

export default function OrderDetail({ saleId, onClose }) {
  const dialog = useRef(null);
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const [detail, history] = await Promise.allSettled([
        fetch(`/api/sales/${saleId}`, { cache: "no-store", signal: controller.signal }).then(readResponse),
        fetch(`/api/sales/${saleId}/history`, { cache: "no-store", signal: controller.signal }).then(readResponse),
      ]);
      if (!controller.signal.aborted) setResult({ detail, history, revision });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [saleId, revision]);
  const current = result?.revision === revision ? result : null;
  const sale = current?.detail.status === "fulfilled" ? current.detail.value : null;
  return <dialog className="order-detail" ref={dialog} onClose={onClose} aria-labelledby="order-detail-heading">
    <header><h2 id="order-detail-heading">{sale ? `Pedido N.º ${sale.saleNumber}` : "Detalle del pedido"}</h2><button className="app-button" onClick={() => dialog.current.close()} type="button">Cerrar</button></header>
    {!current ? <p role="status">Cargando detalle…</p> : !sale ? <p className="inline-error" role="alert">{current.detail.reason.message} <button className="app-button" onClick={() => setRevision((value) => value + 1)} type="button">Reintentar</button></p> : <>
      <dl className="order-detail-data">
        <div><dt>Fecha</dt><dd>{new Date(sale.createdAt).toLocaleString("es-CL")}</dd></div>
        <div><dt>Estado</dt><dd>{labels[sale.status] ?? sale.status}</dd></div>
        <div><dt>Origen</dt><dd>{sale.origin === "ONLINE" ? "WEB" : "POS"}</dd></div>
        <div><dt>Cliente</dt><dd>{sale.customer ? `${sale.customer.firstNames} ${sale.customer.lastNames}` : "Sin cliente registrado"}</dd></div>
        {sale.customer && <><div><dt>RUT</dt><dd>{sale.customer.rut}</dd></div><div><dt>Correo</dt><dd>{sale.customer.email}</dd></div><div><dt>Teléfono</dt><dd>{sale.customer.phone}</dd></div></>}
      </dl>
      <h3>Productos y configuraciones comerciales</h3>
      <div className="order-detail-lines">{sale.items.map((item) => <article key={item.id}><strong>{item.name}</strong><small>SKU {item.sku} · {item.quantity} × {money.format(item.unitPriceCents)}</small>{item.mount && <p>{item.mount.source === "CUSTOMER_FRAME" ? "Montura del cliente" : `Montado en ${sale.items.find((frame) => frame.productId === item.mount.frameProductId)?.name ?? "montura adquirida"}`}</p>}<b>{money.format(item.lineTotalCents)}</b></article>)}{sale.opticalAdditions.map((item) => <article key={item.id}><strong>{item.name}</strong><p>{item.description}</p><small>{item.quantity} × {money.format(item.unitPriceCents)}</small><b>{money.format(item.lineTotalCents)}</b></article>)}</div>
      <dl className="order-detail-data">
        <div><dt>Subtotal</dt><dd>{money.format(sale.subtotalCents)}</dd></div>
        <div><dt>Descuento</dt><dd>{money.format(sale.discountCents)}</dd></div>
        <div><dt>Despacho</dt><dd>{money.format(sale.shippingFeeCents)}</dd></div>
        <div><dt>Total</dt><dd>{money.format(sale.totalCents)}</dd></div>
        <div><dt>Total pagado</dt><dd>{money.format(sale.paidCents)}</dd></div>
        <div><dt>Saldo pendiente</dt><dd>{money.format(sale.balanceCents)}</dd></div>
        <div><dt>Modalidad de entrega</dt><dd>{sale.fulfillment?.method === "DELIVERY" ? "Despacho" : sale.fulfillment?.method === "PICKUP" ? "Retiro en tienda" : "No registrada"}</dd></div>
        {sale.fulfillment?.address && <div><dt>Dirección de entrega</dt><dd>{[sale.fulfillment.address, sale.fulfillment.city, sale.fulfillment.region].filter(Boolean).join(", ")}</dd></div>}
        {sale.fulfillment?.notes && <div><dt>Indicaciones de entrega</dt><dd>{sale.fulfillment.notes}</dd></div>}
      </dl>
      <h3>Historial de cambios</h3>
      {current.history.status === "rejected" ? <p className="inline-error" role="alert">No se pudo consultar el historial. <button className="app-button" onClick={() => setRevision((value) => value + 1)} type="button">Reintentar</button></p> : <ol className="order-history">{current.history.value.map((event) => <li key={event.id}><time>{new Date(event.createdAt).toLocaleString("es-CL")}</time><span>{event.previousStatus ? `${labels[event.previousStatus] ?? event.previousStatus} → ` : ""}{labels[event.newStatus] ?? event.eventType}</span></li>)}</ol>}
    </>}
  </dialog>;
}
