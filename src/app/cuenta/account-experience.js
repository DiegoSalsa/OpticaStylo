"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BookingExperience from "@/app/reservar/booking-experience";
import CartExperience from "@/app/carrito/cart-experience";
import { useCallback, useEffect, useRef, useState } from "react";
import ShipmentPanel from "@/components/shipping/shipment-panel";
import { RecoverOrder, AccountContactPreferences } from "@/components/customers/account-commerce-controls";
import Icon from "@/components/ui/icon";
import PrescriptionDetails from "@/components/prescriptions/prescription-details";
import { formatClp, readStoreResponse } from "@/utils/store-client";
import AccountAuth from "./account-auth";
import AccountPrescriptions from "./account-prescriptions";
import AccountSavedPrescriptions from "./account-saved-prescriptions";
import AccountAdultConfirmation from "./account-adult-confirmation";
import AccountFamily from "./account-family";
import AccountAppointments from "./account-appointments";
import AccountOrderDetails from "./account-order-details";
import AccountProfile from "./account-profile";
import AccountClinicalLink from "./account-clinical-link";
import { accountOrderHref } from "@/utils/account-order-navigation";
import { rememberClinicalPrescription } from "@/utils/store-cart-draft";

const sections = [
  { id: "resumen", label: "Resumen", icon: "home" },
  { id: "pedidos", label: "Mis pedidos", icon: "receipt" },
  { id: "horas", label: "Mis horas", icon: "calendar" },
  { id: "recetas", label: "Mis recetas", icon: "receipt" },
  { id: "menores", label: "Menores a mi cargo", icon: "users" },
  { id: "datos", label: "Mis datos", icon: "account" },
  { id: "carrito", label: "Mi carrito", icon: "cart" },
  { id: "reservar", label: "Reservar hora", icon: "calendar" },
];

const sectionHref = (section) => section === "resumen" ? "/cuenta" : "/cuenta?seccion=" + section;

const orderLabels = { CANCELLED: "Cancelado", DELIVERED: "Entregado", PAID: "Pagado", PAYMENT_PENDING: "Pago pendiente", PENDING: "Pendiente", READY: "Listo", IN_PREPARATION: "En preparación" };


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
  if (account.requiresAgeConfirmation) return <AccountAdultConfirmation onConfirmed={setAccount} onLogout={clearSession} />;
  return <AccountDashboard account={account} key={account.id} onLogout={clearSession} onProfileUpdated={setAccount} />;
}

function AccountDashboard({ account, onLogout, onProfileUpdated }) {
  const searchParams = useSearchParams();
  const section = sections.find(({ id }) => id === searchParams.get("seccion"))?.id ?? "resumen";
  const isOverview = section === "resumen";
  const selectedOrderId = section === "pedidos" ? searchParams.get("pedido") : null;
  const [orders, setOrders] = useState(null);
  const [orderPage, setOrderPage] = useState({ page: 1, totalPages: 0 });
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const ordersRequest = useRef(null);
  const requestedOrderPage = useRef(1);
  const [clinical, setClinical] = useState(null);
  const [clinicalError, setClinicalError] = useState("");
  const clinicalRequest = useRef(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const loadOrders = useCallback(async (page = 1) => {
    ordersRequest.current?.abort();
    requestedOrderPage.current = page;
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
      rememberClinicalPrescription();
      onLogout();
    } catch (error) {
      setLogoutError(error.message);
    } finally {
      setLoggingOut(false);
    }
  }

  return <main className="account-page account-dashboard">
    <aside className="account-sidebar"><div><span className="account-avatar">{account.firstNames?.[0]}{account.lastNames?.[0]}</span><strong>{account.firstNames} {account.lastNames}</strong><small>{account.email}</small></div><nav aria-label="Navegación de mi cuenta">
      {sections.map(({ id, icon, label }) => <Link
        aria-current={section === id ? "page" : undefined}
        className={section === id ? "active" : undefined}
        href={sectionHref(id)}
        key={id}
      ><Icon name={icon} /> {label}</Link>)}
      </nav><button disabled={loggingOut} onClick={logout} type="button"><Icon name="logout" /> {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</button>{logoutError && <p className="inline-error" role="alert">No pudimos cerrar tu sesión. {logoutError}</p>}</aside>
    <section className="account-main" data-section={section} id="resumen">
    {section === "menores" ? <AccountFamily account={account} onExpired={onLogout} /> : section === "reservar" ? <>
      <header><h1>Reservar hora</h1><p>Elige un profesional, fecha y hora para tu evaluación.</p></header>
      <BookingExperience accountProfile={account} accountHoursHref={sectionHref("horas")} onBooked={loadClinical} />
    </> : section === "carrito" ? <CartExperience accountProfile={account} clinicalPrescriptions={clinical?.prescriptions.active} /> : <>
    {isOverview && <><header><p className="eyebrow">Mi cuenta</p><h1>Hola, {account.firstNames}</h1><p>Revisa tus compras y continúa con las acciones disponibles.</p></header>
      <div className="account-banner"><span><Icon name="sparkle" /></span><div><strong>Horas y recetas</strong><p>Consulta tus horas y guarda las recetas que usarás en tus próximas compras.</p></div></div></>}
      {section === "recetas" && <AccountSavedPrescriptions />}
      {/* Mostrar la verificación de correo antes de exponer reservas o recetas. */}
      {((isOverview && (clinical?.linked || clinicalError)) || section === "horas" || (section === "recetas" && clinical?.linked)) && <section className="account-card clinical-card" id="atencion-clinica"><div className="account-card-heading"><div><p className="eyebrow">Atención clínica</p><h2>{clinical ? clinical.linked ? "Atenciones de la óptica" : "Consultar atenciones anteriores" : "Atención clínica"}</h2></div></div>{clinicalError ? <><p className="inline-error" role="alert">{clinicalError}</p><button className="button button--secondary" onClick={loadClinical} type="button">Reintentar atención clínica</button></> : !clinical ? <p role="status">Cargando atención clínica…</p> : !clinical.linked ? <AccountClinicalLink onLinked={loadClinical} onExpired={onLogout} /> : <><p className="clinical-copy">Paciente: {clinical.patient.firstNames} {clinical.patient.lastNames} · RUT {clinical.patient.rutMasked}</p><div className="clinical-columns">{section !== "recetas" && <AccountAppointments clinical={clinical} standalone={!isOverview} reload={loadClinical} />}{section !== "horas" && <AccountPrescriptions accountId={account.id} prescriptions={clinical.prescriptions} standalone={!isOverview} />}</div></>}</section>}
      {isOverview && <div className="account-shortcuts"><article><span><Icon name="calendar" /></span><div><p>Próxima atención</p><strong>Consulta horas disponibles</strong></div><Link href={sectionHref("reservar")}>Reservar <Icon name="arrow" size={16} /></Link></article><article><span><Icon name="eye" /></span><div><p>Probador virtual</p><strong>Compara marcos en 3D</strong></div><Link href="/virtual-try-on/3d">Abrir <Icon name="arrow" size={16} /></Link></article></div>}
      {selectedOrderId && <AccountOrderDetails id={selectedOrderId} key={selectedOrderId} />}{(isOverview || (section === "pedidos" && !selectedOrderId)) && <><section className="account-card orders-card" id="pedidos"><div className="account-card-heading"><div><p className="eyebrow">Compras</p><h2>Mis pedidos</h2></div><Link href="/tienda">Seguir comprando <Icon name="arrow" size={16} /></Link></div>{ordersError && <p className="inline-error" role="alert">{ordersError} <button onClick={() => loadOrders(requestedOrderPage.current)} type="button">Reintentar pedidos</button></p>}{ordersLoading && <p role="status">Cargando pedidos…</p>}{!orders || ordersLoading || (ordersError && orders.length === 0) ? null : orders.length === 0 ? <div className="orders-empty"><Icon name="receipt" /><h3>Aún no tienes pedidos</h3><p>Cuando compres con esta cuenta, tus pedidos aparecerán aquí.</p><Link className="button button--primary" href="/tienda">Explorar catálogo</Link></div> : orders.map((order) => <article className="order-row" key={order.id}><span className="order-icon"><Icon name="package" /></span><div><strong>Pedido N.º {order.saleNumber}</strong><small>{new Date(order.createdAt).toLocaleDateString("es-CL")} · {order.items.length} productos · {order.branch?.name ?? "Sucursal anterior no registrada"}</small></div><span className="status-chip">{orderLabels[order.status] || order.status}</span><b>{formatClp(order.totalCents)}</b><Link className="button button--secondary" href={accountOrderHref(order.id)}>{order.status === "PENDING" && order.balanceCents > 0 ? "Ver pedido y pagar" : "Ver pedido"}</Link>{order.fulfillment?.method === "DELIVERY" && <ShipmentPanel saleId={order.id} />}{(order.externalPrescription || order.prescription) && <PrescriptionDetails endpoint={`/api/store/orders/${order.id}/prescription`} label="Ver receta del pedido" />}</article>)}</section>
      <div className="commercial-actions"><button className="button button--secondary" disabled={ordersLoading || orderPage.page <= 1} onClick={()=>loadOrders(orderPage.page-1)} type="button">Pedidos anteriores</button><span>Página {orderPage.page} / {orderPage.totalPages||1}</span><button className="button button--secondary" disabled={ordersLoading || orderPage.page >= orderPage.totalPages} onClick={()=>loadOrders(orderPage.page+1)} type="button">Pedidos siguientes</button></div><RecoverOrder onRecovered={() => loadOrders(1)} /></>}
      {(isOverview || section === "datos") && <><AccountProfile account={account} onUpdated={onProfileUpdated}/><AccountContactPreferences key={account.phone} /></>}
    </>}
    </section>
  </main>;
}
