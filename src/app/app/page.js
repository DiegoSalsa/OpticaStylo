"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import { canReadCommercialReports, dashboardResult, metricValue } from "@/utils/dashboard";
import Icon from "@/components/ui/icon";
import "./dashboard.css";

const money = new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" });
const modules = [
  ["receipt", "Nueva venta", "Registra una venta o cotización desde el mostrador.", "/app/ventas", "sales.read"],
  ["calendar", "Revisar agenda", "Consulta las horas y estados de atención.", "/app/agenda", "schedules.read"],
  ["package", "Gestionar pedidos", "Avanza pedidos pagados hasta su entrega.", "/app/pedidos", "sales.read"],
];

function localDay(value = new Date()) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(value); }
function customerLabel(sale) { return sale.customer ? [sale.customer.firstNames, sale.customer.lastNames].filter(Boolean).join(" ") : "Sin cliente registrado"; }

export default function InternalHomePage() {
  const actor = useInternalActor();
  const [summary, setSummary] = useState({ appointments: null, sales: null, report: null, orders: null });

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    const today = localDay();
    const monthStart = `${today.slice(0, 8)}01`;
    const now = new Date();
    const agendaFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const agendaTo = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const requests = [
      canReadCommercialReports(actor) ? fetch(`/api/reports/sales?from=${monthStart}&to=${today}`, { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
      actor.permissions.includes("sales.read") ? fetch("/api/sales?page=1&pageSize=6", { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
      actor.permissions.includes("schedules.read") ? fetch(`/api/appointments?from=${encodeURIComponent(agendaFrom)}&to=${encodeURIComponent(agendaTo)}`, { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
      actor.permissions.includes("sales.read") ? fetch("/api/sales/summary?view=active", { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
    ];
    Promise.allSettled(requests).then(([report, sales, appointments, orders]) => {
      if (!controller.signal.aborted) setSummary({ report: dashboardResult(report), sales: dashboardResult(sales), appointments: dashboardResult(appointments), orders: dashboardResult(orders), revision });
    });
    return () => controller.abort();
  }, [actor, revision]);

  const visibleModules = modules.filter((module) => actor?.permissions.includes(module[4]));
  const current = summary.revision === revision ? summary : {};
  const recent = current.sales?.value?.items ?? [];
  const todayAppointments = (current.appointments?.value ?? []).filter((appointment) => localDay(new Date(appointment.startAt)) === localDay());
  const metrics = [
    ["Ventas del mes", metricValue(current.report, (report) => money.format(report.summary.totalCents)), "receipt", current.report],
    ["Pagos registrados", metricValue(current.report, (report) => money.format(report.summary.paidCents)), "chart", current.report],
    ["Horas de hoy", metricValue(current.appointments, () => String(todayAppointments.length)), "calendar", current.appointments],
    ["Pedidos en proceso", metricValue(current.orders, (orders) => String(orders.inProcess)), "package", current.orders],
  ];

  return <>
    <header className="app-heading dashboard-heading"><div><p className="eyebrow">Dashboard</p><h1>Buenos días</h1><p>Resumen operativo construido con los datos registrados en el sistema.</p></div><span className="status-chip">Sesión protegida</span></header>
    <section className="dashboard-metrics" aria-label="Indicadores principales">{metrics.map(([label, value, icon, result]) => <article className="app-card dashboard-metric" key={label}><span><Icon name={icon} /></span><div><small>{label}</small><strong aria-live="polite">{value}</strong>{result?.status === "error" && <small className="inline-error" role="alert">{result.error}</small>}</div></article>)}</section>
    {Object.values(current).some((result) => result?.status === "error") && <button className="app-button" onClick={() => setRevision((value) => value + 1)} type="button">Reintentar indicadores</button>}
    <div className="dashboard-columns"><section className="app-card dashboard-activity"><div className="dashboard-section-heading"><div><p className="eyebrow">Actividad reciente</p><h2>Últimas operaciones</h2></div>{actor?.permissions.includes("sales.read") && <Link href="/app/ventas">Ver ventas <Icon name="arrow" size={15} /></Link>}</div>{!current.sales ? <p className="dashboard-empty">Cargando actividad…</p> : current.sales.status === "error" ? <p className="inline-error" role="alert">{current.sales.error}</p> : current.sales.status === "unavailable" ? <p className="dashboard-empty">Sin acceso a ventas.</p> : recent.length === 0 ? <p className="dashboard-empty">No hay operaciones registradas para mostrar.</p> : <div className="dashboard-list">{recent.map((sale) => <article key={sale.id}><span><Icon name={sale.origin === "ONLINE" ? "cart" : "receipt"} /></span><div><strong>Venta N.º {sale.saleNumber}</strong><small>{customerLabel(sale)} · {sale.origin === "ONLINE" ? "Tienda web" : "Mostrador"}</small></div><b>{money.format(sale.totalCents)}</b><em className={`sale-status sale-status--${sale.status.toLowerCase()}`}>{sale.status}</em></article>)}</div>}</section>
      <aside className="dashboard-side"><section className="app-card dashboard-today"><div className="dashboard-section-heading"><div><p className="eyebrow">Agenda</p><h2>Atenciones de hoy</h2></div><Link href="/app/agenda">Ver agenda</Link></div>{!current.appointments ? <p className="dashboard-empty" role="status">Cargando agenda…</p> : current.appointments.status === "error" ? <p className="inline-error" role="alert">{current.appointments.error}</p> : current.appointments.status === "unavailable" ? <p className="dashboard-empty">Sin acceso a agenda.</p> : todayAppointments.length === 0 ? <p className="dashboard-empty">No hay atenciones registradas para hoy.</p> : todayAppointments.slice(0, 4).map((appointment) => <article key={appointment.id}><time>{new Date(appointment.startAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</time><div><strong>{appointment.patient.firstNames} {appointment.patient.lastNames}</strong><small>{appointment.professional.firstName} {appointment.professional.lastName}</small></div></article>)}</section>
      <section className="dashboard-actions"><p className="eyebrow">Acciones rápidas</p>{visibleModules.map(([icon, name, description, href]) => <Link href={href} key={href}><span><Icon name={icon} /></span><div><strong>{name}</strong><small>{description}</small></div><Icon name="chevron" /></Link>)}</section></aside>
    </div>
  </>;
}
