"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
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
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const canManage = actor?.permissions.includes("customers.manage");
  const requestCustomers = useCallback(
    async (signal) =>
      readResponse(
        await fetch(
          `/api/customers?search=${encodeURIComponent(submitted)}&pageSize=100`,
          { cache: "no-store", signal },
        ),
      ),
    [submitted],
  );
  useEffect(() => {
    if (!actor?.permissions.includes("customers.read")) return;
    const controller = new AbortController();
    requestCustomers(controller.signal)
      .then((data) => {
        setItems(data.items);
        setStatus("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setNotice({ kind: "error", text: error.message });
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [actor, requestCustomers]);
  async function select(customer) {
    setSelectedId(customer.id);
    setStatus("loading-detail");
    try {
      const detail = await readResponse(
        await fetch(`/api/customers/${customer.id}`, { cache: "no-store" }),
      );
      setForm(detail);
      setStatus("ready");
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    }
  }
  function reset() {
    setSelectedId(null);
    setForm(EMPTY);
    setNotice(null);
  }
  async function search(event) {
    event.preventDefault();
    const normalized = query.trim();
    setStatus("loading");
    if (normalized !== submitted) {
      setSubmitted(normalized);
      return;
    }
    try {
      const data = await requestCustomers();
      setItems(data.items);
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("error");
    }
  }
  async function submit(event) {
    event.preventDefault();
    setStatus("saving");
    setNotice(null);
    const payload = {
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
      setForm(saved);
      const data = await requestCustomers();
      setItems(data.items);
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
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo cliente
          </button>
        )}
      </header>
      {notice && (
        <p
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
          {status === "loading" ? (
            <p className="directory-state">Cargando clientes…</p>
          ) : !items.length ? (
            <p className="directory-state">No hay clientes registrados.</p>
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
                  onClick={() => select(customer)}
                  type="button"
                >
                  <span className="management-avatar">
                    {customer.firstNames.slice(0, 1)}
                    {customer.lastNames.slice(0, 1)}
                  </span>
                  <span>
                    <strong>
                      {customer.firstNames} {customer.lastNames}
                    </strong>
                    <small>{customer.rut}</small>
                    <small>{customer.email}</small>
                  </span>
                  <i className="status-dot" />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="app-card management-editor">
          {status === "loading-detail" ? (
            <p className="directory-state">Cargando cliente…</p>
          ) : !selectedId && !canManage ? (
            <p className="directory-state">
              Selecciona un cliente para revisar sus datos.
            </p>
          ) : (
            <form onSubmit={submit}>
              <div className="editor-heading">
                <div>
                  <p className="eyebrow">
                    {selectedId ? "Ficha comercial" : "Alta de cliente"}
                  </p>
                  <h2>
                    {selectedId
                      ? `${form.firstNames} ${form.lastNames}`
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
                    disabled={!canManage}
                    maxLength="150"
                    onChange={(event) =>
                      setForm({ ...form, firstNames: event.target.value })
                    }
                    required
                    value={form.firstNames}
                  />
                </label>
                <label className="field">
                  <span>Apellidos</span>
                  <input
                    disabled={!canManage}
                    maxLength="150"
                    onChange={(event) =>
                      setForm({ ...form, lastNames: event.target.value })
                    }
                    required
                    value={form.lastNames}
                  />
                </label>
                <label className="field">
                  <span>RUT</span>
                  <input
                    disabled={!canManage}
                    onChange={(event) =>
                      setForm({ ...form, rut: event.target.value })
                    }
                    placeholder="12.345.678-5"
                    required
                    value={form.rut}
                  />
                </label>
                <label className="field">
                  <span>Teléfono</span>
                  <input
                    disabled={!canManage}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                    placeholder="+56912345678"
                    required
                    value={form.phone}
                  />
                </label>
                <label className="field field-wide">
                  <span>Correo</span>
                  <input
                    disabled={!canManage}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                    required
                    type="email"
                    value={form.email}
                  />
                </label>
                <label className="field field-wide">
                  <span>Dirección comercial</span>
                  <input
                    disabled={!canManage}
                    maxLength="500"
                    onChange={(event) =>
                      setForm({ ...form, address: event.target.value })
                    }
                    required
                    value={form.address}
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
            </form>
          )}
        </section>
      </div>
    </>
  );
}
