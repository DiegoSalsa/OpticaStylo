"use client";

import { useEffect, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import Pagination from "@/components/internal/pagination";
import OrderDetail from "@/app/app/pedidos/order-detail";
import PrescriptionDetails from "@/components/prescriptions/prescription-details";
import CustomerPrescriptions from "@/components/prescriptions/customer-prescriptions";
import "./commercial-profile.css";
const money = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0
});
const date = v => v ? new Date(v).toLocaleDateString("es-CL", {
  timeZone: "America/Santiago"
}) : "Sin compras válidas";
const labels = {
  QUOTATION: "Cotización",
  PENDING: "Pendiente",
  PAID: "Pagado",
  IN_PREPARATION: "En preparación",
  READY: "Listo",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado"
};
const paymentLabels={CASH:"Efectivo",BANK_TRANSFER:"Transferencia",TRANSBANK:"Transbank",GETNET:"Getnet",MERCADO_PAGO:"Mercado Pago"};
const sourceLabels={IN_PERSON:"Presencial",WRITTEN:"Registro escrito",CUSTOMER_SELF:"Mi cuenta"};
const contacts = {
  UNKNOWN: "Sin autorización registrada",
  GRANTED: "Autorización registrada",
  REVOKED: "Revocada / oposición",
  CONTACT_CHANGED: "Contacto cambiado: requiere nueva autorización"
};
async function api(url, body) {
  return readResponse(await fetch(url, {
    cache: "no-store",
    ...(body ? {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    } : {})
  }));
}
export default function CommercialProfile({
  customerId,
  compact = false,
  revision = 0,
  onUpdated,
  onDirtyChange
}) {
  const actor = useInternalActor(),
    [profile, setProfile] = useState(null),
    [history, setHistory] = useState({
      items: [],
      page: 1,
      total: 0,
      totalPages: 0,
      pageSize: 10
    }),
    [notes, setNotes] = useState({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 0
    }),
    [filter, setFilter] = useState("");
  const [preferences, setPreferences] = useState({
      brands: "",
      models: "",
      notes: "",preferredChannel:""
    }),
    [saved, setSaved] = useState(null),
    [note, setNote] = useState(""),
    [branch, setBranch] = useState(""),
    [branches, setBranches] = useState([]),
    [selectedSale, setSelectedSale] = useState(null),
    [notice, setNotice] = useState(null),
    [busy, setBusy] = useState(false);
  const [contact, setContact] = useState({
    channel: "EMAIL",
    decision: "REVOKED",
    source: "IN_PERSON",
    evidence: "",
    confirm: false
  });
  const canManage = actor?.permissions.includes("customers.manage");
  const dirty = !compact && (!!note || !!contact.evidence || contact.confirm || saved !== null && JSON.stringify(preferences) !== JSON.stringify(saved));
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = e => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    Promise.all([api(`/api/customers/${customerId}/profile`), api(`/api/customers/${customerId}/history?page=1&pageSize=${compact ? 3 : 10}`), ...(compact ? [] : [api(`/api/customers/${customerId}/notes?page=1&pageSize=10`), api("/api/inventory/branches")])]).then(([p, h, n, b]) => {
      if (!active) return;
      setProfile(p);
      setHistory(h);
      if (!compact) {
        const pref = {
          brands: p.preferences.brands.join(", "),
          models: p.preferences.models.join(", "),
          notes: p.preferences.notes ?? "",preferredChannel:p.preferences.preferredChannel??""
        };
        setPreferences(pref);
        setSaved(pref);
        setNotes(n);
        setBranches(b);
        setBranch(b[0]?.id ?? "");
      }
    }).catch(e => {
      if (active) setNotice({
        error: true,
        text: e.message
      });
    });
    return () => {
      active = false;
    };
  }, [customerId, compact, revision]);
  async function refresh() {
    const p = await api(`/api/customers/${customerId}/profile`);
    setProfile(p);
    onUpdated?.(p.customer);
    return p;
  }
  async function perform(action, message) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({
        text: message
      });
    } catch (e) {
      setNotice({
        error: true,
        text: e.message
      });
    } finally {
      setBusy(false);
    }
  }
  async function historyPage(page, status = filter) {
    try {
      setHistory(await api(`/api/customers/${customerId}/history?page=${page}&pageSize=${compact ? 3 : 10}&status=${status}`));
    } catch (e) {
      setNotice({
        error: true,
        text: e.message
      });
    }
  }
  async function notesPage(page) {
    try {
      setNotes(await api(`/api/customers/${customerId}/notes?page=${page}&pageSize=10`));
    } catch (e) {
      setNotice({
        error: true,
        text: e.message
      });
    }
  }
  if (!profile) return <section className="commercial-profile">
  <p role={notice?.error ? "alert" : "status"}>{notice?.text ?? "Consultando perfil comercial autorizado…"}</p>
</section>;
  const summary = profile.summary;
  return <section className="commercial-profile" aria-label="Perfil comercial del cliente">
  {!compact && <header>
    <h3>{profile.customer.firstNames} {profile.customer.lastNames}</h3>
    <p>{profile.customer.rut ?? "Sin RUT"} · {profile.customer.phone ?? "Sin teléfono"} · {profile.customer.email ?? "Sin correo"}</p>
    <p>{profile.customer.address ?? "Sin dirección comercial"}</p>
  </header>}
  <div className="commercial-title">
    <h2>{compact ? "Resumen del cliente" : "Perfil comercial"}</h2>
    <span className="status-chip">{summary.recurring ? "Cliente recurrente" : summary.purchaseCount ? "Con compras anteriores" : "Sin compras válidas"}</span>
  </div>
  <p>{summary.scope === "ALL_BRANCHES" ? "Historial consolidado de las sucursales." : "Indicadores e historial de tus sucursales autorizadas."}</p>
  {notice && <p className={notice.error ? "inline-error" : "inline-success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  <dl className="commercial-metrics">
    <div>
      <dt>Compras válidas</dt>
      <dd>{summary.purchaseCount}</dd>
    </div>
    <div>
      <dt>Última compra</dt>
      <dd>{date(summary.lastPurchaseAt)}</dd>
    </div>
    <div>
      <dt>Total comprado</dt>
      <dd>{money.format(summary.totalSpentCents)}</dd>
    </div>
    <div>
      <dt>Cotizaciones vigentes</dt>
      <dd>{summary.quotationCount}</dd>
    </div>
    {!compact && <><div>
      <dt>Operaciones pendientes</dt>
      <dd>{summary.pendingCount}</dd>
    </div><div>
      <dt>Intervalo histórico promedio</dt>
      <dd>{summary.averageIntervalDays == null ? "Sin intervalo calculable" : `${summary.averageIntervalDays} días`}</dd>
    </div></>}
  </dl>
  <p className="commercial-help">Compras válidas: operaciones totalmente pagadas en estado pagado, preparación, listo o entregado. Cotizaciones, cancelaciones y operaciones con reembolsos o contracargos informados no suman al total.</p>
  {summary.refundReviewCount > 0 && <p>Hay {summary.refundReviewCount} operaciones excluidas por reembolso o contracargo informado; requieren conciliación.</p>}
  {!compact && <p>Registro: {date(profile.customer.createdAt)} · {profile.account.exists ? profile.account.isActive ? "Cuenta de tienda activa" : "Cuenta de tienda inactiva" : "Sin cuenta de tienda"} · Sucursales con compras: {summary.branches.map(b => b.name).join(", ") || "Sin compras registradas"}</p>}
  <details>
    <summary>{compact ? "Compras anteriores del cliente" : "Historial comercial"}</summary>
    {!compact && <label className="field"><span>Filtrar operaciones</span><select value={filter} onChange={e => {
          setFilter(e.target.value);
          historyPage(1, e.target.value);
        }}><option value="">Todas las operaciones</option>{Object.entries(labels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
    {!history.items.length ? <p>Sin operaciones registradas en este ámbito.</p> : history.items.map(row => <article className="commercial-operation" key={row.id}>
      <div>
        <strong>{row.status === "QUOTATION" ? "Cotización" : "Venta"} N.º {row.saleNumber}</strong>
        <span>{date(row.createdAt)} · {row.branchName ?? "Sucursal histórica no registrada"} · {row.origin === "ONLINE" ? "Online" : "Presencial"} · {row.fulfillmentMethod === "DELIVERY" ? "Despacho" : row.fulfillmentMethod === "PICKUP" ? "Retiro" : "Entrega presencial"}</span>
        <span>{labels[row.status]} · {money.format(row.totalCents)}</span>
      </div>
      <ul>{row.items.map((item, i) => <li key={i}>{item.quantity} × {item.name} · {item.sku} · {money.format(item.unitPriceCents)}</li>)}</ul>
      <small>Pagos: {row.payments.length ? row.payments.map(p => `${paymentLabels[p.method]??p.method}: ${money.format(p.amountCents)}`).join(" · ") : "Sin pagos registrados"}</small>
      <div className="commercial-actions">
        <button className="app-button app-button--soft" type="button" onClick={() => setSelectedSale(row.id)}>{compact ? "Ver compra" : "Ver detalle"} N.º {row.saleNumber}</button>
        {!compact && row.externalPrescriptionId && <PrescriptionDetails endpoint={`/api/external-prescriptions/${row.externalPrescriptionId}`} label={`Ver receta comercial N.º ${row.saleNumber}`} />}
        <a href={`/app/ventas?quotationId=${row.id}`} hidden={row.status !== "QUOTATION"}>Abrir cotización en POS</a>
      </div>
    </article>)}
    <Pagination {...history} status={busy ? "loading" : "ready"} setPage={historyPage} label="operaciones" />
  </details>
  {!compact && <>
 <details>
    <summary>Preferencias comerciales declaradas</summary>
    <p>Opcionales. Registre marcas o modelos manifestados por el cliente; evite antecedentes médicos.</p>
    <form onSubmit={e => {
          e.preventDefault();
          perform(async () => {
            await api(`/api/customers/${customerId}/preferences`, {
              expectedVersion: profile.customer.version,
              preferences: {
                brands: preferences.brands.split(",").map(v => v.trim()).filter(Boolean),
                models: preferences.models.split(",").map(v => v.trim()).filter(Boolean),
                notes: preferences.notes || null,preferredChannel:preferences.preferredChannel||null
              }
            });
            setSaved(preferences);
            await refresh();
          }, "Preferencias comerciales guardadas.");
        }}>
      <label className="field"><span>Marcas preferidas, separadas por coma</span><input disabled={!canManage || busy} value={preferences.brands} maxLength={2000} onChange={e => setPreferences({
              ...preferences,
              brands: e.target.value
            })} /></label>
      <label className="field"><span>Modelos consultados, separados por coma</span><input disabled={!canManage || busy} value={preferences.models} maxLength={2000} onChange={e => setPreferences({
              ...preferences,
              models: e.target.value
            })} /></label>
      <label className="field"><span>Canal de contacto preferido, opcional</span><select disabled={!canManage||busy} value={preferences.preferredChannel??""} onChange={e=>setPreferences({...preferences,preferredChannel:e.target.value})}><option value="">Sin preferencia</option><option value="EMAIL">Correo</option><option value="PHONE">Teléfono</option></select><small>Esta preferencia no autoriza publicidad.</small></label>
    <label className="field"><span>Preferencias comerciales adicionales</span><textarea disabled={!canManage || busy} value={preferences.notes} maxLength={1000} onChange={e => setPreferences({
              ...preferences,
              notes: e.target.value
            })} /></label>
      {canManage && <button className="app-button app-button--soft" disabled={busy}>Guardar preferencias</button>}
    </form>
  </details>
 <details>
    <summary>Seguimiento comercial</summary>
    {notes.items.map(n => <article className="commercial-operation" key={n.id}>
      <p>{n.content}</p>
      <small>{date(n.createdAt)} · {n.author} · {n.branch ?? "Gestión general"}</small>
    </article>)}
    {!notes.items.length && <p>Sin notas comerciales.</p>}
    <Pagination {...notes} status={busy ? "loading" : "ready"} setPage={notesPage} label="notas" />
    {canManage && <form onSubmit={e => {
          e.preventDefault();
          perform(async () => {
            await api(`/api/customers/${customerId}/notes`, {
              content: note,
              branchId: branch || null
            });
            setNote("");
            await notesPage(1);
          }, "Nota comercial registrada con responsable y fecha.");
        }}>
      <label className="field"><span>Sucursal de la nota</span><select disabled={busy} value={branch} onChange={e => setBranch(e.target.value)}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field"><span>Nueva nota comercial</span><textarea disabled={busy} value={note} maxLength={2000} required onChange={e => setNote(e.target.value)} /></label>
      <button className="app-button app-button--soft" disabled={busy}>Registrar seguimiento</button>
    </form>}
  </details>
 <details>
    <summary>Comunicaciones comerciales voluntarias</summary>
    <p>{profile.contact.statement}</p>
    {profile.contact.channels.map(c => <p key={c.channel}><strong>{c.channel === "EMAIL" ? "Correo" : "Teléfono"}:</strong> {contacts[c.state]}{c.recordedAt ? ` · ${date(c.recordedAt)} · ${sourceLabels[c.source]??c.source}` : ""}{!c.contactAvailable ? " · Sin contacto registrado" : ""}</p>)}
    {canManage && <form onSubmit={e => {
          e.preventDefault();
          perform(async () => {
            await api(`/api/customers/${customerId}/contact`, contact);
            await refresh();
            setContact({
              ...contact,
              evidence: "",
              confirm: false
            });
          }, "Decisión de contactabilidad registrada. No se enviaron comunicaciones comerciales.");
        }}>
      <div className="management-fields">
        <label className="field"><span>Canal comercial</span><select disabled={busy} value={contact.channel} onChange={e => setContact({
                ...contact,
                channel: e.target.value
              })}><option value="EMAIL">Correo</option><option value="PHONE">Teléfono</option></select></label>
        <label className="field"><span>Decisión del cliente</span><select disabled={busy} value={contact.decision} onChange={e => setContact({
                ...contact,
                decision: e.target.value,
                confirm: false
              })}><option value="REVOKED">Revoca / se opone</option><option value="GRANTED">Autoriza expresamente</option></select></label>
        <label className="field"><span>Origen de la decisión</span><select disabled={busy} value={contact.source} onChange={e => setContact({
                ...contact,
                source: e.target.value
              })}><option value="IN_PERSON">Presencial</option><option value="WRITTEN">Registro escrito</option></select></label>
        <label className="field"><span>Referencia de autorización o revocación</span><input disabled={busy} value={contact.evidence} maxLength={500} required={contact.decision === "GRANTED"} onChange={e => setContact({
                ...contact,
                evidence: e.target.value
              })} /></label>
      </div>
      {contact.decision === "GRANTED" && <label><input type="checkbox" disabled={busy} checked={contact.confirm} required onChange={e => setContact({
              ...contact,
              confirm: e.target.checked
            })} /> Confirmo que el cliente otorgó esta autorización expresa y voluntaria</label>}
      <button className="app-button app-button--soft" disabled={busy}>Registrar decisión</button>
    </form>}
  </details>
 </>}
  {!compact&&<CustomerPrescriptions customerId={customerId}/>}
  {selectedSale && <OrderDetail key={selectedSale} saleId={selectedSale} onClose={() => setSelectedSale(null)} />}
</section>;
}
