"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { formatClp, readStoreResponse } from "@/utils/store-client";

const TEXT = {
  failure: { icon: "shield", title: "El pago no fue aprobado", text: "No registraremos un pago hasta recibir una confirmación válida de Mercado Pago." },
  pending: { icon: "receipt", title: "El pago está pendiente", text: "Mercado Pago todavía está procesando la operación. Esta página se actualizará al confirmarse." },
  success: { icon: "check", title: "Regresaste desde Mercado Pago", text: "Estamos verificando la notificación firmada antes de marcar el pedido como pagado." },
};
const LABEL = { CANCELLED: "Cancelado", PAID: "Pagado", PENDING: "Pendiente", QUOTATION: "Cotización" };

export default function CheckoutResult({ providerResult }) {
  const [order, setOrder] = useState(null); const [status, setStatus] = useState("loading"); const [error, setError] = useState(""); const config = TEXT[providerResult];
  useEffect(() => { let active = true; let timer; let attempts = 0; async function load() { try { const cart = await readStoreResponse(await fetch("/api/store/cart", { cache: "no-store" })); if (!cart.saleId) throw new Error("No encontramos un pedido asociado a este dispositivo."); const current = await readStoreResponse(await fetch(`/api/store/orders/${cart.saleId}`, { cache: "no-store" })); if (!active) return; setOrder(current); setStatus("ready"); attempts += 1; if (current.status === "PENDING" && providerResult !== "failure" && attempts < 6) timer = setTimeout(load, 3000); } catch (requestError) { if (active) { setError(requestError.message); setStatus("error"); } } } void load(); return () => { active = false; clearTimeout(timer); }; }, [providerResult]);
  async function retry() { setStatus("retrying"); setError(""); try { const payment = await readStoreResponse(await fetch(`/api/store/orders/${order.id}/checkout`, { method: "POST" })); if (!payment.checkoutUrl) throw new Error("Mercado Pago no devolvió una URL de pago."); window.location.assign(payment.checkoutUrl); } catch (requestError) { setError(requestError.message); setStatus("ready"); } }
  const paid = order?.status === "PAID"; return <main className="checkout-result"><section className={`result-card ${paid ? "paid" : providerResult}`}><span className="result-icon"><Icon name={paid ? "check" : config.icon} size={36} /></span><p className="eyebrow">Mercado Pago</p><h1>{paid ? "Pago confirmado" : config.title}</h1><p>{paid ? "La confirmación segura ya fue conciliada con tu pedido." : config.text}</p>{status === "loading" && <div className="result-loading"><span className="spinner" /> Consultando el pedido…</div>}{order && <dl><div><dt>Pedido</dt><dd>N.º {order.saleNumber}</dd></div><div><dt>Estado registrado</dt><dd><span className="status-chip">{LABEL[order.status] ?? order.status}</span></dd></div><div><dt>Total</dt><dd>{formatClp(order.totalCents)}</dd></div><div><dt>Pagado</dt><dd>{formatClp(order.paidCents)}</dd></div><div><dt>Saldo</dt><dd>{formatClp(order.balanceCents)}</dd></div></dl>}{order?.status === "PENDING" && <p className="result-note">La URL de retorno no demuestra el pago. Solo el webhook firmado puede acreditarlo; por eso el estado puede tardar algunos segundos.</p>}{error && <p className="inline-error">{error}</p>}<div className="result-actions">{order?.status === "PENDING" && providerResult === "failure" && <button className="button button--primary" disabled={status === "retrying"} onClick={retry} type="button">{status === "retrying" ? "Abriendo…" : "Intentar pagar nuevamente"}</button>}<Link className="button button--secondary" href="/cuenta">Ver mi cuenta</Link><Link href="/tienda">Volver a la tienda</Link></div></section></main>;
}
