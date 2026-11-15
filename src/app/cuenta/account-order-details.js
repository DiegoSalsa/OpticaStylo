"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PrescriptionDetails from "@/components/prescriptions/prescription-details";
import ShipmentPanel from "@/components/shipping/shipment-panel";
import { rememberAccountPayment } from "@/utils/account-order-navigation";
import { formatClp, readStoreResponse } from "@/utils/store-client";

const labels = { CANCELLED: "Cancelado", DELIVERED: "Entregado", PAID: "Pagado", PAYMENT_PENDING: "Pago pendiente", PENDING: "Pendiente", READY: "Listo", IN_PREPARATION: "En preparación" };

export default function AccountOrderDetails({ id }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [retry, setRetry] = useState(0);
  const [paying, setPaying] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/store/orders/" + encodeURIComponent(id), { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse)
      .then((data) => { if (!controller.signal.aborted) setOrder(data); })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);

  function refresh() {
    setLoadError("");
    setPaymentError("");
    setLoading(true);
    setRetry((value) => value + 1);
  }

  async function pay() {
    if (pending.current) return;
    pending.current = true;
    setPaying(true);
    setPaymentError("");
    try {
      const payment = await readStoreResponse(await fetch("/api/store/orders/" + id + "/checkout", { method: "POST" }));
      if (!payment.checkoutUrl) throw new Error("No pudimos abrir Mercado Pago. Inténtalo nuevamente.");
      rememberAccountPayment(id);
      window.location.assign(payment.checkoutUrl);
    } catch (error) {
      setPaymentError(error.status >= 500 ? "El pago no está disponible en este momento. Puedes volver a intentarlo." : error.message);
    } finally {
      pending.current = false;
      setPaying(false);
    }
  }

  return <section className="account-card account-order-detail">
    <Link className="account-order-back" href="/cuenta?seccion=pedidos">← Volver a Mis pedidos</Link>
    {loading && <p role="status">Consultando pedido…</p>}
    {loadError && <p className="inline-error" role="alert">{loadError} <button type="button" onClick={refresh}>Reintentar</button></p>}
    {order && <div>
      <h1>Pedido N.º {order.saleNumber}</h1>
      <p className="status-chip">{labels[order.status] ?? order.status}</p>
      <h2>Productos</h2>
      <ul>{order.items.map((item, index) => <li key={item.id ?? index}>{item.quantity} × {item.name ?? item.product?.name ?? "Producto"}{item.lineTotalCents != null && " · " + formatClp(item.lineTotalCents)}</li>)}</ul>
      <dl className="account-order-totals">
        <div><dt>Total</dt><dd>{formatClp(order.totalCents)}</dd></div>
        <div><dt>Pagado</dt><dd>{formatClp(order.paidCents)}</dd></div>
        <div><dt>Saldo</dt><dd>{formatClp(order.balanceCents)}</dd></div>
        {order.branch && <div><dt>{order.fulfillment?.method === "DELIVERY" ? "Sucursal de despacho" : "Sucursal de retiro"}</dt><dd>{order.branch.name}{order.branch.address && " · " + order.branch.address}</dd></div>}
      </dl>
      <div className="account-card-actions">
        {order.status === "PENDING" && order.balanceCents > 0 && <button className="button button--primary" type="button" disabled={loading || paying} onClick={pay}>
          {paying ? "Abriendo Mercado Pago…" : "Pagar saldo pendiente"}
        </button>}
        <button className="button button--secondary" type="button" disabled={loading || paying} onClick={refresh}>Actualizar estado</button>
      </div>
      {paymentError && <p className="inline-error" role="alert">{paymentError}</p>}
      {order.fulfillment?.method === "DELIVERY" && <ShipmentPanel saleId={order.id} />}
      {(order.externalPrescription || order.prescription) && <PrescriptionDetails endpoint={"/api/store/orders/" + order.id + "/prescription"} label="Ver receta del pedido" />}
    </div>}
  </section>;
}
