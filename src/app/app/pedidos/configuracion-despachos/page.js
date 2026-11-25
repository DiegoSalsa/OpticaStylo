"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { canManageShippingSettings } from "@/auth/permissions";
import { useInternalActor } from "@/components/internal/internal-shell";
import { readStoreResponse, formatClp } from "@/utils/store-client";
import "../../management.css";
import "./shipping-settings.css";

export default function ShippingSettings() {
  const actor = useInternalActor();
  const allowed = canManageShippingSettings(actor);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const current = result?.revision === revision ? result : null;
  const denied = !allowed || current?.status === "denied";
  const settings = denied ? null : current?.settings;

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    fetch("/api/shipping/settings", { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ revision, status: "ready", settings: data });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setResult({ revision, status: failure.status === 403 ? "denied" : "error", message: failure.message });
        }
      });
    return () => controller.abort();
  }, [allowed, revision]);

  async function save(event, kind) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const f = Object.fromEntries(new FormData(event.currentTarget));
    const body = kind === "PRODUCT" ? { kind, id: f.id, logistics: { validated: true, packagingCode: f.code, ...Object.fromEntries(["weightKg","heightCm","widthCm","lengthCm"].map((k) => [k, Number(f[k])])) } }
      : kind === "PACKAGING" ? { kind, packaging: { validated: true, code: f.code, ...Object.fromEntries(["tareWeightKg","heightCm","widthCm","lengthCm","maxUnits"].map((k) => [k, Number(f[k])])) } }
      : { kind, id: f.id, enabled: f.enabled === "true", origin: { validated: true, regionCode: f.regionCode, countyCode: f.countyCode, street: f.street, number: f.number, supplement: f.supplement, name: f.name, email: f.email, phone: f.phone, contentType: Number(f.contentType) } };
    try {
      const response = await fetch("/api/shipping/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const updated = await readStoreResponse(response);
      setResult({ revision, status: "ready", settings: updated });
      setNotice("Configuración guardada. Las cotizaciones afectadas deben recalcularse.");
    } catch (failure) {
      if (failure.status === 403) setResult({ revision, status: "denied" });
      else setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const text = (name, label, type = "text") => <label className="field" key={name}><span>{label}</span><input name={name} type={type} required step={type === "number" ? "0.01" : undefined} /></label>;
  const measures = <>{text("heightCm", "Alto (cm)", "number")}{text("widthCm", "Ancho (cm)", "number")}{text("lengthCm", "Largo (cm)", "number")}</>;
  return <><header className="app-heading"><div><h1>Configuración de despachos</h1><p>Registra únicamente datos medidos y aprobados por la óptica.</p></div><Link href="/app/pedidos">Volver a pedidos</Link></header>
    {denied && <section className="app-card empty-module">
      <h2>Acceso no disponible</h2>
      <p role="alert">No tienes permisos para configurar despachos.</p>
    </section>}
    {!denied && !current && <p role="status">Cargando configuración de despachos…</p>}
    {!denied && current?.status === "error" && <div className="app-card">
      <p className="inline-error" role="alert">No se pudo cargar la configuración. {current.message}</p>
      <button className="app-button" type="button" onClick={() => setRevision((value) => value + 1)}>Reintentar</button>
    </div>}
    {settings && error && <p className="inline-error" role="alert">{error}</p>}
    {settings && notice && <p role="status">{notice}</p>}
    {settings && <div className="shipping-settings-panels"><section className="app-card"><p>Ambiente: {settings.mode}. Envío gratuito sobre {formatClp(settings.threshold)}. Criterio pendiente de confirmación: productos después de descuentos y antes del despacho.</p><p>Credenciales configuradas: cobertura {settings.credentials.coverage ? "sí" : "no"}, cotizador {settings.credentials.rating ? "sí" : "no"}, envíos {settings.credentials.orders ? "sí" : "no"}. Las claves se administran únicamente en el servidor.</p></section>
      <section className="app-card"><h2>Origen por sucursal</h2>{settings.branches.map((b) => <p key={b.id}>{b.name}: retiro {b.pickupEnabled ? "habilitado" : "deshabilitado"}; despacho {b.shippingEnabled ? "habilitado" : "deshabilitado"}{b.origin && ` · ${b.origin.countyCode}, ${b.origin.street} ${b.origin.number}`}</p>)}<form onSubmit={(e) => save(e, "BRANCH")} className="management-fields"><label className="field"><span>Sucursal</span><select name="id" required>{settings.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="field"><span>Origen habilitado</span><select name="enabled"><option value="true">Habilitar</option><option value="false">Deshabilitar</option></select></label>{text("regionCode", "Código de región Chilexpress")}{text("countyCode", "Código de cobertura Chilexpress")}{text("street", "Calle del remitente")}{text("number", "Numeración del remitente")}<label className="field"><span>Complemento</span><input name="supplement" /></label>{text("name", "Nombre remitente")}{text("email", "Correo remitente", "email")}{text("phone", "Teléfono remitente")}<label className="field"><span>Contenido declarado</span><select name="contentType"><option value="5">Otros (5), confirmar con Chilexpress</option><option value="1">Artículos personales (1)</option></select></label><label className="shipping-settings-consent"><input type="checkbox" required /> Confirmo datos de origen verificados</label><button disabled={busy} className="app-button">Guardar origen</button></form></section>
      <section className="app-card"><h2>Embalajes aprobados</h2>{settings.packaging.map((p) => <p key={p.code}>{p.code}: {p.length_cm} × {p.width_cm} × {p.height_cm} cm; tara {p.tare_weight_kg} kg; máximo {p.max_units} unidades; {p.validated ? "validado" : "pendiente"}</p>)}<form className="management-fields" onSubmit={(e) => save(e, "PACKAGING")}>{text("code", "Código de embalaje")}{text("tareWeightKg", "Peso del embalaje vacío (kg)", "number")}{measures}{text("maxUnits", "Capacidad máxima de unidades", "number")}<label className="shipping-settings-consent"><input type="checkbox" required /> Confirmo dimensiones exteriores, capacidad útil y tara verificadas</label><button disabled={busy} className="app-button">Guardar embalaje</button></form></section>
      <section className="app-card"><h2>Logística del producto</h2><p>Un pedido usa un solo bulto aprobado. Los artículos deben compartir código de embalaje y caber conjuntamente; los demás casos requieren una política posterior.</p><form className="management-fields" onSubmit={(e) => save(e, "PRODUCT")}>{text("id", "Identificador del producto")}{text("code", "Código de embalaje compatible")}{text("weightKg", "Peso del producto (kg)", "number")}{measures}<label className="shipping-settings-consent"><input type="checkbox" required /> Confirmo datos físicos medidos</label><button disabled={busy} className="app-button">Guardar logística del producto</button></form></section>
    </div>}
  </>;
}
