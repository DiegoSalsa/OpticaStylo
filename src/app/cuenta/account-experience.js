"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { formatClp, readStoreResponse } from "@/utils/store-client";

const orderLabels = { CANCELLED: "Cancelado", DELIVERED: "Entregado", PAID: "Pagado", PAYMENT_PENDING: "Pago pendiente", PENDING: "Pendiente", READY: "Listo", IN_PREPARATION: "En preparación" };

export default function AccountExperience() {
  const [account, setAccount] = useState(null);
  const [orders, setOrders] = useState([]);
  const [mode, setMode] = useState("LOGIN");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadAccount() {
      try {
        const profile = await readStoreResponse(await fetch("/api/store/accounts/me", { cache: "no-store" }));
        const accountOrders = await readStoreResponse(await fetch("/api/store/orders", { cache: "no-store" }));
        if (active) { setAccount(profile); setOrders(accountOrders); }
      } catch (requestError) { if (active && requestError.status !== 401) setError(requestError.message); }
      finally { if (active) setStatus("ready"); }
    }
    void loadAccount();
    return () => { active = false; };
  }, []);

  async function authenticate(event) {
    event.preventDefault(); setError(""); setStatus("saving");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const endpoint = mode === "LOGIN" ? "login" : "register";
      const result = await readStoreResponse(await fetch(`/api/store/accounts/${endpoint}`, { body: JSON.stringify(values), headers: { "Content-Type": "application/json" }, method: "POST" }));
      setAccount(result.account);
      const accountOrders = await readStoreResponse(await fetch("/api/store/orders", { cache: "no-store" }));
      setOrders(accountOrders); setStatus("ready");
    } catch (requestError) { setError(requestError.message); setStatus("ready"); }
  }

  async function logout() { try { await readStoreResponse(await fetch("/api/store/accounts/logout", { method: "POST" })); } finally { setAccount(null); setOrders([]); setMode("LOGIN"); } }

  if (status === "loading") return <main className="account-page"><div className="account-loading" aria-label="Cargando tu cuenta" /></main>;
  if (!account) return <main className="account-page account-access"><section className="account-intro"><p className="eyebrow">Mi cuenta Stylo</p><h1>{mode === "LOGIN" ? "Qué bueno verte" : "Crea tu cuenta"}</h1><p>Tu carrito también funciona como invitado. Con una cuenta puedes revisar tus pedidos y conservar tus datos de compra.</p><div className="account-benefits"><span><Icon name="receipt" /> Historial de pedidos</span><span><Icon name="cart" /> Compra más rápida</span><span><Icon name="shield" /> Sesión protegida</span></div></section><section className="account-auth"><div className="account-tabs"><button className={mode === "LOGIN" ? "active" : ""} onClick={() => setMode("LOGIN")} type="button">Ingresar</button><button className={mode === "REGISTER" ? "active" : ""} onClick={() => setMode("REGISTER")} type="button">Crear cuenta</button></div><form onSubmit={authenticate}>{mode === "REGISTER" && <><label className="field"><span>RUT</span><input name="rut" required /></label><label className="field"><span>Nombres</span><input name="firstNames" required /></label><label className="field"><span>Apellidos</span><input name="lastNames" required /></label><label className="field"><span>Teléfono</span><input name="phone" required /></label><label className="field field-full"><span>Dirección</span><input name="address" required /></label></>}<label className="field field-full"><span>Correo electrónico</span><input autoComplete="email" name="email" required type="email" /></label><label className="field field-full"><span>Contraseña {mode === "REGISTER" && "(mínimo 15 caracteres)"}</span><input autoComplete={mode === "LOGIN" ? "current-password" : "new-password"} minLength={mode === "REGISTER" ? 15 : 1} name="password" required type="password" /></label>{error && <p className="inline-error field-full">{error}</p>}<button className="button button--primary field-full" disabled={status === "saving"} type="submit">{status === "saving" ? "Procesando…" : mode === "LOGIN" ? "Ingresar" : "Crear cuenta segura"}</button></form></section></main>;

  return <main className="account-page account-dashboard">
    <aside className="account-sidebar"><div><span className="account-avatar">{account.firstNames?.[0]}{account.lastNames?.[0]}</span><strong>{account.firstNames} {account.lastNames}</strong><small>{account.email}</small></div><nav aria-label="Navegación de mi cuenta"><a className="active" href="#resumen"><Icon name="home" /> Resumen</a><a href="#pedidos"><Icon name="receipt" /> Mis pedidos</a><a href="#datos"><Icon name="account" /> Mis datos</a><Link href="/carrito"><Icon name="cart" /> Mi carrito</Link><Link href="/reservar"><Icon name="calendar" /> Reservar hora</Link></nav><button onClick={logout} type="button"><Icon name="logout" /> Cerrar sesión</button></aside>
    <section className="account-main" id="resumen"><header><p className="eyebrow">Mi cuenta</p><h1>Hola, {account.firstNames}</h1><p>Revisa tus compras y continúa con las acciones disponibles.</p></header>
      <div className="account-banner"><span><Icon name="sparkle" /></span><div><strong>Tu experiencia Stylo en un solo lugar</strong><p>Los pedidos mostrados aquí provienen de tu cuenta real. La agenda clínica seguirá separada hasta contar con una vinculación segura entre cliente y paciente.</p></div></div>
      <div className="account-shortcuts"><article><span><Icon name="calendar" /></span><div><p>Próxima atención</p><strong>Consulta horas disponibles</strong></div><Link href="/reservar">Reservar <Icon name="arrow" size={16} /></Link></article><article><span><Icon name="eye" /></span><div><p>Probador virtual</p><strong>Compara marcos en 3D</strong></div><Link href="/virtual-try-on/3d">Abrir <Icon name="arrow" size={16} /></Link></article></div>
      <section className="account-card orders-card" id="pedidos"><div className="account-card-heading"><div><p className="eyebrow">Compras</p><h2>Mis pedidos</h2></div><Link href="/tienda">Seguir comprando <Icon name="arrow" size={16} /></Link></div>{orders.length === 0 ? <div className="orders-empty"><Icon name="receipt" /><h3>Aún no tienes pedidos</h3><p>Cuando compres con esta cuenta, tus pedidos aparecerán aquí.</p><Link className="button button--primary" href="/tienda">Explorar catálogo</Link></div> : orders.map((order) => <article className="order-row" key={order.id}><span className="order-icon"><Icon name="package" /></span><div><strong>Pedido N.º {order.saleNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("es-CL")} · {order.items.length} productos</small></div><span className="status-chip">{orderLabels[order.status] || order.status}</span><b>{formatClp(order.totalCents)}</b></article>)}</section>
      <section className="account-card account-data" id="datos"><div className="account-card-heading"><div><p className="eyebrow">Información personal</p><h2>Mis datos</h2></div></div><dl><div><dt>Nombre</dt><dd>{account.firstNames} {account.lastNames}</dd></div><div><dt>RUT</dt><dd>{account.rut}</dd></div><div><dt>Teléfono</dt><dd>{account.phone}</dd></div><div><dt>Dirección</dt><dd>{account.address}</dd></div></dl></section>
    </section>
  </main>;
}
