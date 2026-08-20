"use client";

import Link from "next/link";

import { useInternalActor } from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";

const modules = [
  ["receipt", "Ventas POS", "Registra cotizaciones, descuentos, ventas y abonos desde el mostrador.", "/app/ventas", "sales.read"],
  ["calendar", "Agenda", "Administra horas y disponibilidad clínica según tus permisos.", "/app/agenda", "schedules.read"],
  ["account", "Pacientes", "Consulta información clínica sin mezclarla con los datos comerciales.", "/app/pacientes", "patients.read_basic"],
  ["package", "Productos", "Mantén el catálogo comercial; el stock seguirá simulado hasta la etapa 6.", "/app/productos", "products.read"],
  ["users", "Clientes", "Gestiona los datos necesarios para compras y ventas.", "/app/clientes", "customers.read"],
  ["chart", "Reportes", "Revisa actividad comercial y deja preparados los indicadores de inventario.", "/app/reportes", "reports.read"],
];

export default function InternalHomePage() {
  const actor = useInternalActor();
  const visibleModules = modules.filter((module) => actor?.permissions.includes(module[4]));
  return <>
    <header className="app-heading"><div><p className="eyebrow">Aplicación interna</p><h1>Centro de trabajo</h1><p>Accesos ordenados por función y rol.</p></div><span className="status-chip">Sesión protegida</span></header>
    <section className="app-grid" aria-label="Módulos de la aplicación">
      {visibleModules.map(([icon,name,description,href]) => <article className="app-card module-card" key={href}><span className="module-icon"><Icon name={icon} /></span><h2>{name}</h2><p>{description}</p><Link href={href}>Abrir módulo <Icon name="arrow" size={16} /></Link></article>)}
    </section>
  </>;
}
