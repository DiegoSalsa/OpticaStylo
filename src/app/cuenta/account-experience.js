"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/ui/icon";
import { formatClp, readStoreResponse } from "@/utils/store-client";

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
      } catch (requestError) {
        if (active && requestError.status !== 401) setError(requestError.message);
      } finally { if (active) setStatus("ready"); }
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
      setAccount(result.account); setOrders([]); setStatus("ready");
    } catch (requestError) { setError(requestError.message); setStatus("ready"); }
  }

  async function logout() {
    try { await readStoreResponse(await fetch("/api/store/accounts/logout", { method: "POST" })); } finally { setAccount(null); setOrders([]); setMode("LOGIN"); }
  }

  if (status === "loading") return <main className="account-page"><p>Cargando tu cuenta…</p></main>;
  if (!account) return <main className="account-page"><section className="account-intro"><p className="eyebrow">Cuenta de cliente</p><h1>{mode==="LOGIN"?"Qué bueno verte":"Crea tu cuenta"}</h1><p>Tu carrito también funciona como invitado. La cuenta te permite consultar tus pedidos y conservar tus datos.</p></section><section className="account-auth"><div className="account-tabs"><button className={mode==="LOGIN"?"active":""} onClick={()=>setMode("LOGIN")} type="button">Ingresar</button><button className={mode==="REGISTER"?"active":""} onClick={()=>setMode("REGISTER")} type="button">Crear cuenta</button></div><form onSubmit={authenticate}>{mode==="REGISTER"&&<><label className="field"><span>RUT</span><input name="rut" required /></label><label className="field"><span>Nombres</span><input name="firstNames" required /></label><label className="field"><span>Apellidos</span><input name="lastNames" required /></label><label className="field"><span>Teléfono</span><input name="phone" required /></label><label className="field field-full"><span>Dirección</span><input name="address" required /></label></>}<label className="field field-full"><span>Correo electrónico</span><input autoComplete="email" name="email" required type="email" /></label><label className="field field-full"><span>Contraseña {mode==="REGISTER"&&"(mínimo 15 caracteres)"}</span><input autoComplete={mode==="LOGIN"?"current-password":"new-password"} minLength={mode==="REGISTER"?15:1} name="password" required type="password" /></label>{error&&<p className="inline-error field-full">{error}</p>}<button className="button button--primary field-full" disabled={status==="saving"} type="submit">{status==="saving"?"Procesando…":mode==="LOGIN"?"Ingresar":"Crear cuenta segura"}</button></form></section></main>;
  return <main className="account-page account-dashboard"><header><div><p className="eyebrow">Mi cuenta</p><h1>Hola, {account.firstNames}</h1><p>{account.email} · {account.rut}</p></div><button className="account-logout" onClick={logout} type="button"><Icon name="logout" /> Cerrar sesión</button></header><div className="account-grid"><section className="account-card"><h2>Mis datos</h2><dl><div><dt>Nombre</dt><dd>{account.firstNames} {account.lastNames}</dd></div><div><dt>Teléfono</dt><dd>{account.phone}</dd></div><div><dt>Dirección</dt><dd>{account.address}</dd></div></dl></section><section className="account-card orders-card"><h2>Mis pedidos</h2>{orders.length===0?<div className="orders-empty"><Icon name="receipt" /><p>Aún no hay pedidos asociados a esta cuenta.</p></div>:orders.map((order)=><article className="order-row" key={order.id}><div><strong>Pedido N.º {order.saleNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("es-CL")} · {order.items.length} productos</small></div><span className="status-chip">{order.status}</span><b>{formatClp(order.totalCents)}</b></article>)}</section></div></main>;
}
