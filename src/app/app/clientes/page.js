"use client";

import { useEffect, useRef, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Pagination from "@/components/internal/pagination";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import { createRequestGate } from "@/utils/pagination";
import Icon from "@/components/ui/icon";
import CommercialProfile from "@/components/customers/commercial-profile";
import "../management.css";

const EMPTY = {
  address: "",
  email: "",
  firstNames: "",
  lastNames: "",
  patientId: null,
  phone: "",
  rut: "",
};

export default function CustomersPage() {
  const actor = useInternalActor();
  const [query, setQuery] = useState("");
  const [segment,setSegment]=useState("ALL"),[days,setDays]=useState(365),[profileDirty,setProfileDirty]=useState(false),[savedForm,setSavedForm]=useState(EMPTY);

  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("ready");
  const [notice, setNotice] = useState(null);
  const basicDirty=JSON.stringify(form)!==JSON.stringify(savedForm);
  const canManage = actor?.permissions.includes("customers.manage");
  const list = usePaginatedResource("/api/customers", { enabled: Boolean(actor?.permissions.includes("customers.read")) });
  const { items } = list;
  const detailGate = useRef(createRequestGate());
  const saving = useRef(false);
  useEffect(() => { const gate = detailGate.current; return () => gate.cancel(); }, []);
  useEffect(()=>{
    const dirty=basicDirty||profileDirty;
    const unload=e=>{if(dirty){e.preventDefault();e.returnValue="";}};
    const navigate=e=>{const a=e.target.closest?.("a[href]");if(dirty&&a&&a.target!=="_blank"&&e.button===0&&!e.ctrlKey&&!e.metaKey&&new URL(a.href).pathname!==window.location.pathname&&!window.confirm("Hay cambios comerciales sin guardar. ¿Salir y descartarlos?")){e.preventDefault();e.stopPropagation();}};
    window.addEventListener("beforeunload",unload);document.addEventListener("click",navigate,true);return()=>{window.removeEventListener("beforeunload",unload);document.removeEventListener("click",navigate,true);};
  },[basicDirty,profileDirty]);

  async function select(customer) {
    if (saving.current) return;
    if((basicDirty||profileDirty)&&!window.confirm("Hay cambios comerciales sin guardar. ¿Descartarlos y continuar?"))return;
    const request = detailGate.current.begin();
    setSelectedId(customer.id);
    setForm(EMPTY);
    setStatus("loading-detail");
    setNotice(null);
    try {
      const detail = await readResponse(await fetch(`/api/customers/${customer.id}`, { cache: "no-store", signal: request.signal }));
      if (!request.isCurrent()) return;
      setForm(detail);setSavedForm(detail);
      setStatus("ready");
    } catch (error) {
      if (!request.isCurrent()) return;
      setNotice({ kind: "error", text: error.message });
      setStatus("detail-error");
    }
  }
  function reset() {
    if (saving.current) return;
    if((basicDirty||profileDirty)&&!window.confirm("Hay cambios comerciales sin guardar. ¿Descartarlos y continuar?"))return;
    detailGate.current.cancel();
    setStatus("ready");
    setSelectedId(null);
    setForm(EMPTY);setSavedForm(EMPTY);
    setNotice(null);
  }
  function search(event) {
    event.preventDefault();
    list.setFilters({ search: query.trim(),segment,days });
  }
  async function submit(event) {
    event.preventDefault();
    if (saving.current || status !== "ready") return;
    saving.current = true;
    setStatus("saving");
    setNotice(null);
    const payload = {
      expectedVersion:form.version,
      address: form.address,
      email: form.email,
      firstNames: form.firstNames,
      lastNames: form.lastNames,
      phone: form.phone,
      rut: form.rut,
    };
    try {
      const saved = await readResponse(
        await fetch(
          selectedId ? `/api/customers/${selectedId}` : "/api/customers",
          {
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            method: selectedId ? "PATCH" : "POST",
          },
        ),
      );
      setSelectedId(saved.id);
      setForm(saved);setSavedForm(saved);
      list.reload();
      setStatus("ready");
      setNotice({
        kind: "success",
        text: selectedId
          ? "Datos comerciales actualizados."
          : "Cliente comercial creado.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    } finally {
      saving.current = false;
    }
  }
  if (actor && !actor.permissions.includes("customers.read"))
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>Este módulo no corresponde a tu rol.</p>
      </section>
    );
  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Gestión comercial</p>
          <h1>Clientes</h1>
          <p>
            Identidad de compra independiente de la ficha clínica del paciente.
          </p>
        </div>
        {canManage && (
          <button
            className="app-button app-button--primary"
            disabled={status === "saving"}
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo cliente
          </button>
        )}
      </header>
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error" ? "inline-error" : "inline-success"
          }
        >
          {notice.text}
        </p>
      )}
      <div className="management-layout">
        <section className="app-card directory-card">
          <form className="directory-search" onSubmit={search}>
            <Icon name="search" />
            <input
              aria-label="Buscar clientes"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre, RUT, correo o teléfono"
              value={query}
            />
            <button className="app-button" type="submit">
              Buscar
            </button>
          </form>
          <div className="management-fields"><label className="field"><span>Segmento comercial</span><select value={segment} onChange={e=>setSegment(e.target.value)}><option value="ALL">Todos los clientes</option><option value="NEW">Registrados en el período</option><option value="PREVIOUS">Con compras anteriores</option><option value="REPEAT">Recurrentes · dos o más compras</option><option value="INACTIVE">Sin compras recientes</option><option value="QUOTED">Con cotizaciones vigentes</option></select></label><label className="field"><span>Período del filtro, en días</span><input type="number" min="1" max="3650" value={days} onChange={e=>setDays(e.target.value)}/></label><button className="app-button app-button--soft" type="button" onClick={()=>list.setFilters({search:query.trim(),segment,days})}>Aplicar segmento</button></div>
          {list.status === "loading" ? (
            <p className="directory-state">Cargando clientes…</p>
          ) : list.status === "error" ? null : !items.length ? (
            <p className="directory-state">{list.filters.search ? "No hay coincidencias para esta búsqueda." : "No hay clientes registrados."}</p>
          ) : (
            <div className="management-list">
              {items.map((customer) => (
                <button
                  className={
                    selectedId === customer.id
                      ? "management-item active"
                      : "management-item"
                  }
                  key={customer.id}
                  disabled={status === "saving"}
                  onClick={() => select(customer)}
                  type="button"
                >
                  <span className="management-avatar">
                    {customer.firstNames.slice(0, 1)}
                    {customer.lastNames?.slice(0, 1)}
                  </span>
                  <span>
                    <strong>
                      {customer.firstNames} {customer.lastNames}
                    </strong>
                    <small>{customer.rut}</small>
                    <small>{customer.email}</small><small>{customer.summary?.purchaseCount??0} compras válidas{customer.summary?.recurring?" · Recurrente":""}</small>
                  </span>
                  <i className="status-dot" />
                </button>
              ))}
            </div>
          )}
          <Pagination {...list} label="clientes" />
        </section>
        <section className="app-card management-editor">
          {status === "loading-detail" ? (
            <p className="directory-state">Cargando cliente…</p>
          ) : status === "detail-error" ? (
            <p className="inline-error" role="alert">No se pudo cargar la selección. Vuelve a seleccionarla para reintentar.</p>
          ) : !selectedId && !canManage ? (
            <p className="directory-state">
              Selecciona un cliente para revisar sus datos.
            </p>
          ) : (
            <details open={!selectedId}><summary>{selectedId?"Editar datos de contacto":"Registrar cliente"}</summary><form onSubmit={submit}>
              <div className="editor-heading">
                <div>
                  <p className="eyebrow">
                    {selectedId ? "Ficha comercial" : "Alta de cliente"}
                  </p>
                  <h2>
                    {selectedId
                      ? [form.firstNames, form.lastNames].filter(Boolean).join(" ")
                      : "Nuevo cliente"}
                  </h2>
                </div>
                {form.patientId && (
                  <span className="status-chip">Vinculado a paciente</span>
                )}
              </div>
              <div className="management-fields">
                <label className="field">
                  <span>Nombres</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    maxLength="150"
                    onChange={(event) =>
                      setForm({ ...form, firstNames: event.target.value })
                    }
                    placeholder="Nombres del cliente"
                    required
                    value={form.firstNames}
                  />
                </label>
                <label className="field">
                  <span>Apellidos</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    maxLength="150"
                    onChange={(event) =>
                      setForm({ ...form, lastNames: event.target.value })
                    }
                    placeholder="Apellidos del cliente"
                    value={form.lastNames ?? ""}
                  />
                </label>
                <label className="field">
                  <span>RUT</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    onChange={(event) =>
                      setForm({ ...form, rut: event.target.value })
                    }
                    placeholder="12.345.678-5"
                    value={form.rut ?? ""}
                  />
                </label>
                <label className="field">
                  <span>Teléfono</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                    placeholder="+56912345678"
                    value={form.phone ?? ""}
                  />
                </label>
                <label className="field field-wide">
                  <span>Correo</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                    placeholder="nombre@correo.cl"
                    type="email"
                    value={form.email ?? ""}
                  />
                </label>
                <label className="field field-wide">
                  <span>Dirección comercial</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    maxLength="500"
                    onChange={(event) =>
                      setForm({ ...form, address: event.target.value })
                    }
                    placeholder="Dirección"
                    value={form.address ?? ""}
                  />
                </label>
              </div>
              {form.patientId && (
                <p className="inline-success">
                  El vínculo con Paciente se conserva, pero editar estos datos
                  no altera su ficha clínica.
                </p>
              )}
              <div className="editor-actions">
                <button
                  className="app-button app-button--primary"
                  disabled={!canManage || status === "saving"}
                  type="submit"
                >
                  {status === "saving"
                    ? "Guardando…"
                    : selectedId
                      ? "Guardar cambios"
                      : "Crear cliente"}
                </button>
              </div>
            </form></details>
          )}
          {selectedId && actor?.permissions.includes("sales.read") && <CommercialProfile customerId={selectedId} key={selectedId} onDirtyChange={setProfileDirty} onUpdated={customer=>{setForm(v=>({...v,version:customer.version}));setSavedForm(v=>({...v,version:customer.version}));list.reload();}} />}
        </section>
      </div>
    </>
  );
}
