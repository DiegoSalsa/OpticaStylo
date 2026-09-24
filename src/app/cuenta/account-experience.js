"use client";
// Código de la aplicación para account-experience.

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { formatClp, readStoreResponse } from "@/utils/store-client";

const orderLabels = { CANCELLED: "Cancelado", DELIVERED: "Entregado", PAID: "Pagado", PAYMENT_PENDING: "Pago pendiente", PENDING: "Pendiente", READY: "Listo", IN_PREPARATION: "En preparación" };

export default function AccountExperience() {
  const [account, setAccount] = useState(null);
  const [orders, setOrders] = useState([]);
  const [clinical, setClinical] = useState(null);
  const [linkStatus, setLinkStatus] = useState("idle");
  const [linkError, setLinkError] = useState("");
  const [mode, setMode] = useState("LOGIN");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Consultar load account y devolver los datos en el formato esperado por la capa llamadora
    async function loadAccount() {
      try {
        const [profile, accountOrders, accountClinical] = await Promise.all([
          readStoreResponse(await fetch("/api/store/accounts/me", { cache: "no-store" })),
          readStoreResponse(await fetch("/api/store/orders", { cache: "no-store" })),
          readStoreResponse(await fetch("/api/store/accounts/me/clinical", { cache: "no-store" })),
        ]);
        if (active) { setAccount(profile); setClinical(accountClinical); setOrders(accountOrders); }
      } catch (requestError) { if (active && requestError.status !== 401) setError(requestError.message); }
      finally { if (active) setStatus("ready"); }
    }
    void loadAccount();
    return () => { active = false; };
  }, []);

  // Centralizar la lógica de authenticate para mantener consistente el comportamiento de la aplicación
  async function authenticate(event) {
    event.preventDefault(); setError(""); setStatus("saving");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const endpoint = mode === "LOGIN" ? "login" : "register";
      const result = await readStoreResponse(await fetch(`/api/store/accounts/${endpoint}`, { body: JSON.stringify(values), headers: { "Content-Type": "application/json" }, method: "POST" }));
      setAccount(result.account);
      const [accountOrders, accountClinical] = await Promise.all([
        readStoreResponse(await fetch("/api/store/orders", { cache: "no-store" })),
        readStoreResponse(await fetch("/api/store/accounts/me/clinical", { cache: "no-store" })),
      ]);
      setClinical(accountClinical); setOrders(accountOrders); setStatus("ready");
    } catch (requestError) { setError(requestError.message); setStatus("ready"); }
  }

  // Centralizar la lógica de logout para mantener consistente el comportamiento de la aplicación
  async function logout() { try { await readStoreResponse(await fetch("/api/store/accounts/logout", { method: "POST" })); } finally { setAccount(null); setClinical(null); setOrders([]); setMode("LOGIN"); } }

  // Enviar la fecha de nacimiento al backend para verificar la identidad sin aceptar patientId.
  async function linkClinical(event) {
    event.preventDefault(); setLinkError(""); setLinkStatus("saving");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await readStoreResponse(await fetch("/api/store/accounts/me/patient-link", {
        body: JSON.stringify(values), headers: { "Content-Type": "application/json" }, method: "POST",
      }));
      setClinical(await readStoreResponse(await fetch("/api/store/accounts/me/clinical", { cache: "no-store" })));
      setLinkStatus("idle");
    } catch (requestError) { setLinkError(requestError.message); setLinkStatus("idle"); }
  }

  // Formatear las fechas de agenda para mantener una lectura consistente en la cuenta.
  function formatClinicalDate(value, options = {}) {
    return new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short", ...options });
  }

  if (status === "loading") return <main className="account-page"><div className="account-loading" aria-label="Cargando tu cuenta" /></main>;
  if (!account) return <main className="account-page account-access"><section className="account-intro"><p className="eyebrow">Mi cuenta Stylo</p><h1>{mode === "LOGIN" ? "Qué bueno verte" : "Crea tu cuenta"}</h1><p>Tu carrito también funciona como invitado. Con una cuenta puedes revisar tus pedidos y conservar tus datos de compra.</p><div className="account-benefits"><span><Icon name="receipt" /> Historial de pedidos</span><span><Icon name="cart" /> Compra más rápida</span><span><Icon name="shield" /> Sesión protegida</span></div></section><section className="account-auth"><div className="account-tabs"><button className={mode === "LOGIN" ? "active" : ""} onClick={() => setMode("LOGIN")} type="button">Ingresar</button><button className={mode === "REGISTER" ? "active" : ""} onClick={() => setMode("REGISTER")} type="button">Crear cuenta</button></div><form onSubmit={authenticate}>{mode === "REGISTER" && <><label className="field"><span>RUT</span><input name="rut" placeholder="12.345.678-5" required /></label><label className="field"><span>Nombres</span><input name="firstNames" placeholder="Nombres" required /></label><label className="field"><span>Apellidos</span><input name="lastNames" placeholder="Apellidos" required /></label><label className="field"><span>Teléfono</span><input name="phone" placeholder="+56 9 1234 5678" required /></label><label className="field field-full"><span>Dirección</span><input name="address" placeholder="Dirección" required /></label></>}<label className="field field-full"><span>Correo electrónico</span><input autoComplete="email" name="email" placeholder="nombre@correo.cl" required type="email" /></label><label className="field field-full"><span>Contraseña {mode === "REGISTER" && "(mínimo 15 caracteres)"}</span><input autoComplete={mode === "LOGIN" ? "current-password" : "new-password"} minLength={mode === "REGISTER" ? 15 : 1} name="password" placeholder="Tu contraseña" required type="password" /></label>{error && <p className="inline-error field-full">{error}</p>}<button className="button button--primary field-full" disabled={status === "saving"} type="submit">{status === "saving" ? "Procesando…" : mode === "LOGIN" ? "Ingresar" : "Crear cuenta segura"}</button></form></section></main>;

  return <main className="account-page account-dashboard">
    <aside className="account-sidebar"><div><span className="account-avatar">{account.firstNames?.[0]}{account.lastNames?.[0]}</span><strong>{account.firstNames} {account.lastNames}</strong><small>{account.email}</small></div><nav aria-label="Navegación de mi cuenta"><a className="active" href="#resumen"><Icon name="home" /> Resumen</a><a href="#pedidos"><Icon name="receipt" /> Mis pedidos</a><a href="#atencion-clinica"><Icon name="calendar" /> Atención clínica</a><a href="#horas"><Icon name="calendar" /> Mis horas</a><a href="#recetas"><Icon name="receipt" /> Mis recetas</a><a href="#datos"><Icon name="account" /> Mis datos</a><Link href="/carrito"><Icon name="cart" /> Mi carrito</Link><Link href="/reservar"><Icon name="calendar" /> Reservar hora</Link></nav><button onClick={logout} type="button"><Icon name="logout" /> Cerrar sesión</button></aside>
    <section className="account-main" id="resumen"><header><p className="eyebrow">Mi cuenta</p><h1>Hola, {account.firstNames}</h1><p>Revisa tus compras y continúa con las acciones disponibles.</p></header>
      <div className="account-banner"><span><Icon name="sparkle" /></span><div><strong>Tu experiencia Stylo en un solo lugar</strong><p>Los pedidos mostrados aquí provienen de tu cuenta real. La agenda clínica se muestra únicamente después de verificar tu identidad.</p></div></div>
      {/* Mostrar el estado de vinculación y las proyecciones clínicas públicas permitidas. */}
      <section className="account-card clinical-card" id="atencion-clinica"><div className="account-card-heading"><div><p className="eyebrow">Atención clínica</p><h2>{clinical?.linked ? "Atención clínica vinculada" : "Vincular atención clínica"}</h2></div></div>{!clinical?.linked ? <><p className="clinical-copy">Verifica tu fecha de nacimiento para consultar tus próximas horas y recetas emitidas por Óptica Stylo.</p><form className="clinical-link-form" onSubmit={linkClinical}><label className="field"><span>Fecha de nacimiento</span><input max={new Date().toISOString().slice(0, 10)} name="birthDate" required type="date" /></label>{linkError && <p className="inline-error">{linkError}</p>}<button className="button button--primary" disabled={linkStatus === "saving"} type="submit">{linkStatus === "saving" ? "Verificando…" : "Vincular atención clínica"}</button></form></> : <><p className="clinical-copy">Paciente: {clinical.patient.firstNames} {clinical.patient.lastNames} · RUT {clinical.patient.rutMasked}</p><div className="clinical-columns"><section id="horas"><h3>Mis horas</h3><h4>Próximas horas</h4>{clinical.upcomingAppointments.length === 0 ? <p className="clinical-empty">No tienes próximas horas agendadas.</p> : clinical.upcomingAppointments.map((appointment) => <article className="clinical-row" key={`${appointment.startAt}-${appointment.professional?.lastName}`}><strong>{formatClinicalDate(appointment.startAt)}</strong><span>{appointment.professional ? `${appointment.professional.firstName} ${appointment.professional.lastName}` : "Profesional"}</span><small>{appointment.status}</small></article>)}<h4>Historial</h4>{clinical.appointmentHistory.length === 0 ? <p className="clinical-empty">Aún no tienes atenciones anteriores.</p> : clinical.appointmentHistory.map((appointment) => <article className="clinical-row" key={`${appointment.startAt}-${appointment.status}`}><strong>{formatClinicalDate(appointment.startAt)}</strong><span>{appointment.professional ? `${appointment.professional.firstName} ${appointment.professional.lastName}` : "Profesional"}</span><small>{appointment.status}</small></article>)}</section><section id="recetas"><h3>Mis recetas</h3>{clinical.prescriptions.active.length === 0 ? <p className="clinical-empty">No tienes recetas vigentes disponibles.</p> : clinical.prescriptions.active.map((prescription) => <article className="prescription-row" key={prescription.issuedAt}><strong>Emitida el {new Date(prescription.issuedAt).toLocaleDateString("es-CL")}</strong><span>{prescription.professional ? `Por ${prescription.professional.firstName} ${prescription.professional.lastName}` : "Profesional"}</span><small>OD {prescription.rightEye.sphere} / {prescription.rightEye.cylinder} · OI {prescription.leftEye.sphere} / {prescription.leftEye.cylinder}</small></article>)}{clinical.prescriptions.history.length > 0 && <><h4>Versiones anteriores</h4>{clinical.prescriptions.history.map((prescription) => <article className="prescription-row" key={`${prescription.issuedAt}-${prescription.status}`}><strong>{new Date(prescription.issuedAt).toLocaleDateString("es-CL")}</strong><span>{prescription.status === "REPLACED" ? "Reemplazada" : "Anulada"}</span></article>)}</>}</section></div></>}</section>
      <div className="account-shortcuts"><article><span><Icon name="calendar" /></span><div><p>Próxima atención</p><strong>Consulta horas disponibles</strong></div><Link href="/reservar">Reservar <Icon name="arrow" size={16} /></Link></article><article><span><Icon name="eye" /></span><div><p>Probador virtual</p><strong>Compara marcos en 3D</strong></div><Link href="/virtual-try-on/3d">Abrir <Icon name="arrow" size={16} /></Link></article></div>
      <section className="account-card orders-card" id="pedidos"><div className="account-card-heading"><div><p className="eyebrow">Compras</p><h2>Mis pedidos</h2></div><Link href="/tienda">Seguir comprando <Icon name="arrow" size={16} /></Link></div>{orders.length === 0 ? <div className="orders-empty"><Icon name="receipt" /><h3>Aún no tienes pedidos</h3><p>Cuando compres con esta cuenta, tus pedidos aparecerán aquí.</p><Link className="button button--primary" href="/tienda">Explorar catálogo</Link></div> : orders.map((order) => <article className="order-row" key={order.id}><span className="order-icon"><Icon name="package" /></span><div><strong>Pedido N.º {order.saleNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("es-CL")} · {order.items.length} productos</small></div><span className="status-chip">{orderLabels[order.status] || order.status}</span><b>{formatClp(order.totalCents)}</b></article>)}</section>
      <section className="account-card account-data" id="datos"><div className="account-card-heading"><div><p className="eyebrow">Información personal</p><h2>Mis datos</h2></div></div><dl><div><dt>Nombre</dt><dd>{account.firstNames} {account.lastNames}</dd></div><div><dt>RUT</dt><dd>{account.rut}</dd></div><div><dt>Teléfono</dt><dd>{account.phone}</dd></div><div><dt>Dirección</dt><dd>{account.address}</dd></div></dl></section>
    </section>
  </main>;
}
