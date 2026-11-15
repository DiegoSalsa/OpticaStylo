"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ShipmentPanel from "@/components/shipping/shipment-panel";
import { RecoverOrder, AccountContactPreferences } from "@/components/customers/account-commerce-controls";
import Icon from "@/components/ui/icon";
import PrescriptionDetails from "@/components/prescriptions/prescription-details";
import { formatClp, readStoreResponse } from "@/utils/store-client";
import AccountAuth from "./account-auth";

const orderLabels = { CANCELLED: "Cancelado", DELIVERED: "Entregado", PAID: "Pagado", PAYMENT_PENDING: "Pago pendiente", PENDING: "Pendiente", READY: "Listo", IN_PREPARATION: "En preparación" };
const appointmentLabels = { CANCELLED: "Cancelada", CHECKED_IN: "En atención", COMPLETED: "Atendida", CONFIRMED: "Confirmada", NO_SHOW: "No asistió" };
const prescriptionLabels = { REPLACED: "Reemplazada", VOIDED: "Anulada" };

function opticalValue(value) {
  return value == null ? "—" : String(value);
}

function formatClinicalDate(value) {
  return new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" });
}

export default function AccountExperience() {
  const [account, setAccount] = useState(null);
  const [sessionStatus, setSessionStatus] = useState("loading");
  const [sessionError, setSessionError] = useState("");
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/store/accounts/me", { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse)
      .then((profile) => { if (!controller.signal.aborted) setAccount(profile); })
      .catch((error) => {
        if (!controller.signal.aborted && error.status !== 401) setSessionError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setSessionStatus("ready"); });
    return () => controller.abort();
  }, [sessionAttempt]);

  const clearSession = useCallback(() => setAccount(null), []);
  if (sessionStatus === "loading") return <main className="account-page"><p role="status">Cargando tu cuenta…</p></main>;
  if (sessionError) return <main className="account-page">
    <p role="alert">{sessionError}</p>
    <button className="button button--secondary" onClick={() => {
      setSessionStatus("loading");
      setSessionError("");
      setSessionAttempt((value) => value + 1);
    }} type="button">Reintentar cargar mi cuenta</button>
  </main>;
  if (!account) return <AccountAuth onAuthenticated={setAccount} />;
  return <AccountDashboard account={account} key={account.id} onLogout={clearSession} />;
}

function AccountDashboard({ account, onLogout }) {
  const [orders, setOrders] = useState(null);
  const [orderPage, setOrderPage] = useState({ page: 1, totalPages: 0 });
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const ordersRequest = useRef(null);
  const [clinical, setClinical] = useState(null);
  const [clinicalError, setClinicalError] = useState("");
  const clinicalRequest = useRef(null);
  const [linkStep, setLinkStep] = useState("identity");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [linkStatus, setLinkStatus] = useState("idle");
  const [linkError, setLinkError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const loadOrders = useCallback(async (page = 1) => {
    ordersRequest.current?.abort();
    const controller = new AbortController();
    ordersRequest.current = controller;
    setOrdersLoading(true);
    setOrdersError("");
    try {
      const result = await readStoreResponse(await fetch("/api/store/orders?page=" + page + "&pageSize=10", { cache: "no-store", signal: controller.signal }));
      if (controller.signal.aborted) return;
      setOrders(result.items);
      setOrderPage(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.status === 401) onLogout();
      else setOrdersError(error.message);
    } finally {
      if (!controller.signal.aborted) setOrdersLoading(false);
    }
  }, [onLogout]);

  const loadClinical = useCallback(async () => {
    clinicalRequest.current?.abort();
    const controller = new AbortController();
    clinicalRequest.current = controller;
    setClinicalError("");
    try {
      const result = await readStoreResponse(await fetch("/api/store/accounts/me/clinical", { cache: "no-store", signal: controller.signal }));
      if (!controller.signal.aborted) setClinical(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.status === 401) onLogout();
      else setClinicalError(error.message);
    }
  }, [onLogout]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void loadOrders();
      void loadClinical();
    });
    return () => {
      active = false;
      ordersRequest.current?.abort();
      clinicalRequest.current?.abort();
    };
  }, [loadOrders, loadClinical]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await readStoreResponse(await fetch("/api/store/accounts/logout", { method: "POST" }));
      onLogout();
    } catch (error) {
      setLogoutError(error.message);
    } finally {
      setLoggingOut(false);
    }
  }

  async function linkClinical(event) {
    event.preventDefault();
    setLinkError("");
    setLinkStatus("saving");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const endpoint = linkStep === "identity" ? "patient-link/request-code" : "patient-link";
    try {
      const result = await readStoreResponse(await fetch("/api/store/accounts/me/" + endpoint, {
        body: JSON.stringify(values), headers: { "Content-Type": "application/json" }, method: "POST",
      }));
      if (result.linked) {
        setLinkStep("identity");
        setMaskedEmail("");
        await loadClinical();
      } else {
        setMaskedEmail(result.maskedEmail);
        setLinkStep("otp");
      }
    } catch (error) {
      if (error.status === 401) onLogout();
      else setLinkError(error.message);
    } finally {
      setLinkStatus("idle");
    }
  }


  return <main className="account-page account-dashboard">
    <aside className="account-sidebar"><div><span className="account-avatar">{account.firstNames?.[0]}{account.lastNames?.[0]}</span><strong>{account.firstNames} {account.lastNames}</strong><small>{account.email}</small></div><nav aria-label="Navegación de mi cuenta"><a className="active" href="#resumen"><Icon name="home" /> Resumen</a><a href="#pedidos"><Icon name="receipt" /> Mis pedidos</a><a href="#atencion-clinica"><Icon name="calendar" /> Atención clínica</a><a href="#horas"><Icon name="calendar" /> Mis horas</a><a href="#recetas"><Icon name="receipt" /> Mis recetas</a><a href="#datos"><Icon name="account" /> Mis datos</a><Link href="/carrito"><Icon name="cart" /> Mi carrito</Link><Link href="/reservar"><Icon name="calendar" /> Reservar hora</Link></nav><button disabled={loggingOut} onClick={logout} type="button"><Icon name="logout" /> {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</button>{logoutError && <p className="inline-error" role="alert">No pudimos cerrar tu sesión. {logoutError}</p>}</aside>
    <section className="account-main" id="resumen"><header><p className="eyebrow">Mi cuenta</p><h1>Hola, {account.firstNames}</h1><p>Revisa tus compras y continúa con las acciones disponibles.</p></header>
      <div className="account-banner"><span><Icon name="sparkle" /></span><div><strong>Tu experiencia Stylo en un solo lugar</strong><p>Los pedidos mostrados aquí provienen de tu cuenta real. La agenda clínica se muestra únicamente después de verificar tu identidad.</p></div></div>
      {/* Mostrar la verificación de correo antes de exponer reservas o recetas. */}
      <section className="account-card clinical-card" id="atencion-clinica"><div className="account-card-heading"><div><p className="eyebrow">Atención clínica</p><h2>{clinical ? clinical.linked ? "Atención clínica vinculada" : "Vincular atención clínica" : "Atención clínica"}</h2></div></div>{clinicalError ? <><p className="inline-error" role="alert">{clinicalError}</p><button className="button button--secondary" onClick={loadClinical} type="button">Reintentar atención clínica</button></> : !clinical ? <p role="status">Cargando atención clínica…</p> : !clinical.linked ? <>{linkStep === "identity" ? <><p className="clinical-copy">Verifica tu fecha de nacimiento y recibe un código en el correo registrado en tu atención clínica.</p><form className="clinical-link-form" onSubmit={linkClinical}><label className="field"><span>Fecha de nacimiento</span><input max={new Date().toISOString().slice(0, 10)} name="birthDate" required type="date" /></label>{linkError && <p className="inline-error">{linkError}</p>}<button className="button button--primary" disabled={linkStatus === "saving"} type="submit">{linkStatus === "saving" ? "Verificando…" : "Enviar código"}</button></form></> : <><p className="clinical-copy">Enviamos un código temporal a {maskedEmail}. No compartas ese código.</p><form className="clinical-link-form" onSubmit={linkClinical}><label className="field"><span>Código de verificación</span><input autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required /></label>{linkError && <p className="inline-error">{linkError}</p>}<button className="button button--primary" disabled={linkStatus === "saving"} type="submit">{linkStatus === "saving" ? "Confirmando…" : "Confirmar código"}</button></form></>}</> : <><p className="clinical-copy">Paciente: {clinical.patient.firstNames} {clinical.patient.lastNames} · RUT {clinical.patient.rutMasked}</p><div className="clinical-columns"><section id="horas"><h3>Mis horas</h3><h4>Próximas horas</h4>{clinical.upcomingAppointments.length === 0 ? <p className="clinical-empty">No tienes próximas horas agendadas.</p> : clinical.upcomingAppointments.map((appointment) => <article className="clinical-row" key={`${appointment.startAt}-${appointment.professional?.lastName}`}><strong>{formatClinicalDate(appointment.startAt)}</strong><span>{appointment.professional ? `${appointment.professional.firstName} ${appointment.professional.lastName}` : "Profesional"}</span><small>{appointmentLabels[appointment.status] || appointment.status}</small></article>)}<h4>Historial</h4>{clinical.appointmentHistory.length === 0 ? <p className="clinical-empty">Aún no tienes atenciones anteriores.</p> : clinical.appointmentHistory.map((appointment) => <article className="clinical-row" key={`${appointment.startAt}-${appointment.status}`}><strong>{formatClinicalDate(appointment.startAt)}</strong><span>{appointment.professional ? `${appointment.professional.firstName} ${appointment.professional.lastName}` : "Profesional"}</span><small>{appointmentLabels[appointment.status] || appointment.status}</small></article>)}</section><section id="recetas"><h3>Mis recetas</h3>{clinical.prescriptions.active.length === 0 ? <p className="clinical-empty">No tienes recetas vigentes disponibles.</p> : clinical.prescriptions.active.map((prescription) => <article className="prescription-row" key={prescription.issuedAt}><strong>Vigente · Emitida el {new Date(prescription.issuedAt).toLocaleDateString("es-CL")}</strong><span>{prescription.professional ? `Por ${prescription.professional.firstName} ${prescription.professional.lastName}` : "Profesional"}</span><small>OD esfera {opticalValue(prescription.rightEye.sphere)} · cilindro {opticalValue(prescription.rightEye.cylinder)} · eje {opticalValue(prescription.rightEye.axis)} · adición {opticalValue(prescription.rightEye.addition)}</small><small>OI esfera {opticalValue(prescription.leftEye.sphere)} · cilindro {opticalValue(prescription.leftEye.cylinder)} · eje {opticalValue(prescription.leftEye.axis)} · adición {opticalValue(prescription.leftEye.addition)}</small><small>Distancia pupilar {opticalValue(prescription.pupillaryDistance)}{prescription.fulfillmentNotes ? ` · Preparación: ${prescription.fulfillmentNotes}` : ""}</small></article>)}{clinical.prescriptions.history.length > 0 && <><h4>Versiones anteriores</h4>{clinical.prescriptions.history.map((prescription) => <article className="prescription-row" key={`${prescription.issuedAt}-${prescription.status}`}><strong>{prescriptionLabels[prescription.status] || "Anulada"} · {new Date(prescription.issuedAt).toLocaleDateString("es-CL")}</strong><span>{prescription.professional ? `Por ${prescription.professional.firstName} ${prescription.professional.lastName}` : "Profesional"}</span></article>)}</>}</section></div></>}</section>
      <div className="account-shortcuts"><article><span><Icon name="calendar" /></span><div><p>Próxima atención</p><strong>Consulta horas disponibles</strong></div><Link href="/reservar">Reservar <Icon name="arrow" size={16} /></Link></article><article><span><Icon name="eye" /></span><div><p>Probador virtual</p><strong>Compara marcos en 3D</strong></div><Link href="/virtual-try-on/3d">Abrir <Icon name="arrow" size={16} /></Link></article></div>
      <section className="account-card orders-card" id="pedidos"><div className="account-card-heading"><div><p className="eyebrow">Compras</p><h2>Mis pedidos</h2></div><Link href="/tienda">Seguir comprando <Icon name="arrow" size={16} /></Link></div>{ordersError && <p className="inline-error" role="alert">{ordersError} <button onClick={() => loadOrders(orderPage.page)} type="button">Reintentar pedidos</button></p>}{ordersLoading && <p role="status">Cargando pedidos…</p>}{!orders || ordersLoading ? null : orders.length === 0 ? <div className="orders-empty"><Icon name="receipt" /><h3>Aún no tienes pedidos</h3><p>Cuando compres con esta cuenta, tus pedidos aparecerán aquí.</p><Link className="button button--primary" href="/tienda">Explorar catálogo</Link></div> : orders.map((order) => <article className="order-row" key={order.id}><span className="order-icon"><Icon name="package" /></span><div><strong>Pedido N.º {order.saleNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("es-CL")} · {order.items.length} productos · {order.branch?.name ?? "Sucursal anterior no registrada"}</small></div><span className="status-chip">{orderLabels[order.status] || order.status}</span><b>{formatClp(order.totalCents)}</b>{order.fulfillment?.method === "DELIVERY" && <ShipmentPanel saleId={order.id} />}{(order.externalPrescription || order.prescription) && <PrescriptionDetails endpoint={`/api/store/orders/${order.id}/prescription`} label="Ver receta del pedido" />}</article>)}</section>
      <div className="commercial-actions"><button className="button button--secondary" disabled={ordersLoading || orderPage.page <= 1} onClick={()=>loadOrders(orderPage.page-1)} type="button">Pedidos anteriores</button><span>Página {orderPage.page} / {orderPage.totalPages||1}</span><button className="button button--secondary" disabled={ordersLoading || orderPage.page >= orderPage.totalPages} onClick={()=>loadOrders(orderPage.page+1)} type="button">Pedidos siguientes</button></div><RecoverOrder onRecovered={()=>loadOrders(1)}/><AccountContactPreferences/>
      <section className="account-card account-data" id="datos"><div className="account-card-heading"><div><p className="eyebrow">Información personal</p><h2>Mis datos</h2></div></div><dl><div><dt>Nombre</dt><dd>{account.firstNames} {account.lastNames}</dd></div><div><dt>RUT</dt><dd>{account.rut}</dd></div><div><dt>Teléfono</dt><dd>{account.phone}</dd></div><div><dt>Dirección</dt><dd>{account.address}</dd></div></dl></section>
    </section>
  </main>;
}

