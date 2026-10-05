"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import "./dashboard.css";

const money = new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" });
const modules = [
  ["receipt", "Nueva venta", "Registra una venta o cotización desde el mostrador.", "/app/ventas", "sales.read"],
  ["calendar", "Revisar agenda", "Consulta las horas y estados de atención.", "/app/agenda", "schedules.read"],
  ["package", "Gestionar pedidos", "Avanza pedidos pagados hasta su entrega.", "/app/pedidos", "sales.read"],
];

function localDay(value = new Date()) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(value); }
function customerLabel(sale) { return sale.customer ? `${sale.customer.firstNames} ${sale.customer.lastNames}` : "Sin cliente registrado"; }

export default function InternalHomePage() {
  const actor = useInternalActor();
  const [summary, setSummary] = useState({ appointments: null, recent: [], report: null, status: "loading" });

  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    const today = localDay();
    const monthStart = `${today.slice(0, 8)}01`;
    const now = new Date();
    const agendaFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const agendaTo = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const requests = [
      actor.permissions.includes("reports.read") ? fetch(`/api/reports/sales?from=${monthStart}&to=${today}`, { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
      actor.permissions.includes("sales.read") ? fetch("/api/sales?page=1&pageSize=6", { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
      actor.permissions.includes("schedules.read") ? fetch(`/api/appointments?from=${encodeURIComponent(agendaFrom)}&to=${encodeURIComponent(agendaTo)}`, { cache: "no-store", signal: controller.signal }).then(readResponse) : Promise.resolve(null),
    ];
    Promise.allSettled(requests).then(([report, sales, appointments]) => setSummary({ appointments: appointments.status === "fulfilled" ? appointments.value : null, recent: sales.status === "fulfilled" ? sales.value?.items ?? [] : [], report: report.status === "fulfilled" ? report.value : null, status: "ready" }));
    return () => controller.abort();
  }, [actor]);

  const visibleModules = modules.filter((module) => actor?.permissions.includes(module[4]));
  const todayAppointments = (summary.appointments ?? []).filter((appointment) => localDay(new Date(appointment.startAt)) === localDay());
  const pendingOrders = summary.recent.filter((sale) => ["PAID", "IN_PREPARATION", "READY"].includes(sale.status)).length;
  const metrics = [
    ["Ventas del mes", summary.report ? money.format(summary.report.summary.totalCents) : "—", "receipt"],
    ["Pagos registrados", summary.report ? money.format(summary.report.summary.paidCents) : "—", "chart"],
    ["Horas de hoy", summary.appointments ? String(todayAppointments.length) : "—", "calendar"],
    ["Pedidos en proceso", summary.status === "ready" ? String(pendingOrders) : "—", "package"],
  ];

  return <>
    <header className="app-heading dashboard-heading"><div><p className="eyebrow">Dashboard</p><h1>Buenos días</h1><p>Resumen operativo construido con los datos registrados en el sistema.</p></div><span className="status-chip">Sesión protegida</span></header>
    <section className="dashboard-metrics" aria-label="Indicadores principales">{metrics.map(([label, value, icon]) => <article className="app-card dashboard-metric" key={label}><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></article>)}</section>
    <div className="dashboard-columns"><section className="app-card dashboard-activity"><div className="dashboard-section-heading"><div><p className="eyebrow">Actividad reciente</p><h2>Últimas operaciones</h2></div>{actor?.permissions.includes("sales.read") && <Link href="/app/ventas">Ver ventas <Icon name="arrow" size={15} /></Link>}</div>{summary.status === "loading" ? <p className="dashboard-empty">Cargando actividad…</p> : summary.recent.length === 0 ? <p className="dashboard-empty">No hay operaciones registradas para mostrar.</p> : <div className="dashboard-list">{summary.recent.map((sale) => <article key={sale.id}><span><Icon name={sale.origin === "ONLINE" ? "cart" : "receipt"} /></span><div><strong>Venta N.º {sale.saleNumber}</strong><small>{customerLabel(sale)} · {sale.origin === "ONLINE" ? "Tienda web" : "Mostrador"}</small></div><b>{money.format(sale.totalCents)}</b><em className={`sale-status sale-status--${sale.status.toLowerCase()}`}>{sale.status}</em></article>)}</div>}</section>
      <aside className="dashboard-side"><section className="app-card dashboard-today"><div className="dashboard-section-heading"><div><p className="eyebrow">Agenda</p><h2>Atenciones de hoy</h2></div><Link href="/app/agenda">Ver agenda</Link></div>{summary.appointments === null ? <p className="dashboard-empty">Sin acceso o sin datos de agenda.</p> : todayAppointments.length === 0 ? <p className="dashboard-empty">No hay atenciones registradas para hoy.</p> : todayAppointments.slice(0, 4).map((appointment) => <article key={appointment.id}><time>{new Date(appointment.startAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</time><div><strong>{appointment.patient.firstNames} {appointment.patient.lastNames}</strong><small>{appointment.professional.firstName} {appointment.professional.lastName}</small></div></article>)}</section>
      <section className="dashboard-actions"><p className="eyebrow">Acciones rápidas</p>{visibleModules.map(([icon, name, description, href]) => <Link href={href} key={href}><span><Icon name={icon} /></span><div><strong>{name}</strong><small>{description}</small></div><Icon name="chevron" /></Link>)}</section></aside>
    </div>
  </>;
}
