"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import BrandLogo from "@/components/brand/brand-logo";
import Icon from "@/components/ui/icon";

const NAVIGATION = [
  { href: "/app", icon: "home", label: "Dashboard", permissions: [] },
  { href: "/app/agenda", icon: "calendar", label: "Agenda", permissions: ["schedules.read"] },
  { href: "/app/ficha-clinica", icon: "file", label: "Gestión clínica", permissions: ["medical_records.read_assigned"] },
  { href: "/app/ventas", icon: "receipt", label: "Ventas y cotizaciones", permissions: ["sales.read"] },
  { href: "/app/pedidos", icon: "package", label: "Gestión de pedidos", permissions: ["sales.read"] },
  { href: "/app/productos", icon: "eye", label: "Catálogo e inventario", permissions: ["products.read"] },
  { href: "/app/usuarios", icon: "users", label: "Gestión de usuarios", permissions: ["users.read"] },
  { href: "/app/reportes", icon: "chart", label: "Reportes y analítica", permissions: ["sales.reports_read"] },
];

const ActorContext = createContext(null);

async function readResponse(response) {
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "No fue posible completar la solicitud.");
  return body?.data;
}

export default function InternalShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [actor, setActor] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" }).then(readResponse)
      .then((data) => { if (active) { setActor(data); setStatus("ready"); } })
      .catch(() => { if (active) router.replace(`/ingresar?next=${encodeURIComponent(pathname)}`); });
    return () => { active = false; };
  }, [pathname, router]);

  const navigation = useMemo(() => NAVIGATION.filter((item) =>
    item.permissions.every((permission) => actor?.permissions.includes(permission))), [actor]);

  async function logout() {
    try { await readResponse(await fetch("/api/auth/logout", { method: "POST" })); } catch { /* cookie is still invalidated on success only */ }
    router.replace("/ingresar");
    router.refresh();
  }

  if (status === "loading") {
    return <main className="internal-loading"><span className="spinner" /> Verificando sesión segura…</main>;
  }

  return (
    <div className="internal-shell">
      <aside className="internal-sidebar">
        <Link className="internal-brand" href="/app"><BrandLogo /></Link>
        {actor?.permissions.includes("sales.create") && <Link className="internal-quick-sale" href="/app/ventas"><Icon name="plus" size={17} /> Nueva venta</Link>}
        <p className="internal-nav-label">Operación</p>
        <nav aria-label="Navegación interna">
          {navigation.map((item) => {
            const active = item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href);
            return <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={item.href} key={item.href}><Icon name={item.icon} size={19} />{item.label}</Link>;
          })}
        </nav>
        <div className="internal-user">
          <span>{actor?.email?.slice(0, 1).toUpperCase()}</span>
          <div><strong>{actor?.email}</strong><small>{actor?.roles.join(" · ")}</small></div>
          <button aria-label="Cerrar sesión" onClick={logout} type="button"><Icon name="logout" size={18} /></button>
        </div>
      </aside>
      <div className="internal-content"><header className="internal-topbar"><div><strong>Óptica Stylo</strong><span>Gestión interna</span></div><nav aria-label="Accesos rápidos"><Link href="/" target="_blank">Ver tienda</Link><span>{new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(new Date())}</span></nav></header><main className="internal-main"><ActorContext.Provider value={actor}>{children}</ActorContext.Provider></main></div>
    </div>
  );
}

export { readResponse };
export function useInternalActor() { return useContext(ActorContext); }
