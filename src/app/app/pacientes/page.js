"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Pagination from "@/components/internal/pagination";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import { createRequestGate } from "@/utils/pagination";
import Icon from "@/components/ui/icon";
import "../management.css";
import "./patients.css";

const EMPTY_GUARDIAN = {
  email: "",
  firstNames: "",
  lastNames: "",
  phone: "",
  relationship: "",
  rut: "",
};
const EMPTY = {
  address: "",
  birthDate: "",
  email: "",
  firstNames: "",
  guardian: null,
  lastNames: "",
  phone: "",
  rut: "",
};
function isMinor(birthDate) {
  if (!birthDate) return false;
  const birth = new Date(`${birthDate}T00:00:00`);
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 18);
  return birth > limit;
}

export default function PatientsPage() {
  const actor = useInternalActor();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("ready");
  const [notice, setNotice] = useState(null);
  const canManage = actor?.permissions.includes("patients.manage_basic");
  const minor = useMemo(() => isMinor(form.birthDate), [form.birthDate]);
  const list = usePaginatedResource("/api/patients", { enabled: Boolean(actor?.permissions.includes("patients.read_basic")) });
  const { items } = list;
  const detailGate = useRef(createRequestGate());
  const saving = useRef(false);
  useEffect(() => { const gate = detailGate.current; return () => gate.cancel(); }, []);

  async function select(patient) {
    if (saving.current) return;
    const request = detailGate.current.begin();
    setSelectedId(patient.id);
    setForm(EMPTY);
    setStatus("loading-detail");
    setNotice(null);
    try {
      const detail = await readResponse(await fetch(`/api/patients/${patient.id}`, { cache: "no-store", signal: request.signal }));
      if (!request.isCurrent()) return;
      setForm({ ...detail, guardian: detail.guardian ? { ...detail.guardian } : null });
      setStatus("ready");
    } catch (error) {
      if (!request.isCurrent()) return;
      setNotice({ kind: "error", text: error.message });
      setStatus("detail-error");
    }
  }
  function reset() {
    if (saving.current) return;
    detailGate.current.cancel();
    setStatus("ready");
    setSelectedId(null);
    setForm(EMPTY);
    setNotice(null);
  }
  function search(event) {
    event.preventDefault();
    list.setFilters({ search: query.trim() });
  }
  function setGuardian(field, value) {
    setForm((current) => ({
      ...current,
      guardian: { ...(current.guardian ?? EMPTY_GUARDIAN), [field]: value },
    }));
  }
  async function submit(event) {
    event.preventDefault();
    if (saving.current || status !== "ready") return;
    saving.current = true;
    setStatus("saving");
    setNotice(null);
    const payload = {
      address: form.address,
      birthDate: form.birthDate,
      email: form.email,
      firstNames: form.firstNames,
      guardian: minor ? (form.guardian ?? EMPTY_GUARDIAN) : null,
      lastNames: form.lastNames,
      phone: form.phone,
      rut: form.rut,
    };
    try {
      const saved = await readResponse(
        await fetch(
          selectedId ? `/api/patients/${selectedId}` : "/api/patients",
          {
            body: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            method: selectedId ? "PATCH" : "POST",
          },
        ),
      );
      setSelectedId(saved.id);
      setForm(saved);
      list.reload();
      setStatus("ready");
      setNotice({
        kind: "success",
        text: selectedId
          ? "Datos básicos del paciente actualizados."
          : "Paciente registrado correctamente.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    } finally {
      saving.current = false;
    }
  }
  if (actor && !actor.permissions.includes("patients.read_basic"))
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>No tienes permiso para consultar pacientes.</p>
      </section>
    );

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Identidad clínica</p>
          <h1>Pacientes</h1>
          <p>
            Los datos clínicos permanecen separados de los clientes de venta.
          </p>
        </div>
        {canManage && (
          <button
            className="app-button app-button--primary"
            disabled={status === "saving"}
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo paciente
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
              aria-label="Buscar pacientes"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre, RUT, correo o teléfono"
              value={query}
            />
            <button className="app-button" type="submit">
              Buscar
            </button>
          </form>
          {list.status === "loading" ? (
            <p className="directory-state">Cargando pacientes…</p>
          ) : list.status === "error" ? null : !items.length ? (
            <p className="directory-state">{list.filters.search ? "No hay coincidencias para esta búsqueda." : "No hay pacientes registrados."}</p>
          ) : (
            <div className="management-list">
              {items.map((patient) => (
                <button
                  className={
                    selectedId === patient.id
                      ? "management-item active"
                      : "management-item"
                  }
                  key={patient.id}
                  disabled={status === "saving"}
                  onClick={() => select(patient)}
                  type="button"
                >
                  <span className="management-avatar">
                    {patient.firstNames.slice(0, 1)}
                    {patient.lastNames.slice(0, 1)}
                  </span>
                  <span>
                    <strong>
                      {patient.firstNames} {patient.lastNames}
                    </strong>
                    <small>{patient.rut}</small>
                    <small>{patient.email}</small>
                  </span>
                  <i className="status-dot" />
                </button>
              ))}
            </div>
          )}
          <Pagination {...list} label="pacientes" />
        </section>
        <section className="app-card management-editor">
          {status === "loading-detail" ? (
            <p className="directory-state">Cargando ficha básica…</p>
          ) : status === "detail-error" ? (
            <p className="inline-error" role="alert">No se pudo cargar la selección. Vuelve a seleccionarla para reintentar.</p>
          ) : !selectedId && !canManage ? (
            <div className="directory-state">
              Selecciona un paciente para revisar sus datos básicos.
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="editor-heading">
                <div>
                  <p className="eyebrow">
                    {selectedId ? "Ficha de identidad" : "Registro de paciente"}
                  </p>
                  <h2>
                    {selectedId
                      ? `${form.firstNames} ${form.lastNames}`
                      : "Nuevo paciente"}
                  </h2>
                </div>
                {minor && (
                  <span className="status-chip status-chip--pending">
                    Menor de edad
                  </span>
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
                    placeholder="Nombres del paciente"
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
                    placeholder="Apellidos del paciente"
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
                  <span>Fecha de nacimiento</span>
                  <input
                    disabled={!canManage}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) =>
                      setForm({ ...form, birthDate: event.target.value })
                    }
                    required
                    type="date"
                    value={form.birthDate}
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
                <label className="field">
                  <span>Correo</span>
                  <input
                    disabled={!canManage}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                    required
                    placeholder="nombre@correo.cl"
                    type="email"
                    value={form.email}
                  />
                </label>
                <label className="field field-wide">
                  <span>Dirección</span>
                  <input
                    disabled={!canManage}
                    maxLength="500"
                    onChange={(event) =>
                      setForm({ ...form, address: event.target.value })
                    }
                    required
                    placeholder="Dirección"
                    value={form.address}
                  />
                </label>
              </div>
              {minor && (
                <fieldset className="guardian-fields">
                  <legend>Responsable obligatorio</legend>
                  <div className="management-fields">
                    <label className="field">
                      <span>Nombres</span>
                      <input
                        disabled={!canManage}
                        onChange={(event) =>
                          setGuardian("firstNames", event.target.value)
                        }
                        required
                        placeholder="Nombres del responsable"
                        value={form.guardian?.firstNames ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>Apellidos</span>
                      <input
                        disabled={!canManage}
                        onChange={(event) =>
                          setGuardian("lastNames", event.target.value)
                        }
                        required
                        placeholder="Apellidos del responsable"
                        value={form.guardian?.lastNames ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>RUT</span>
                      <input
                        disabled={!canManage}
                        onChange={(event) =>
                          setGuardian("rut", event.target.value)
                        }
                        required
                        placeholder="12.345.678-5"
                        value={form.guardian?.rut ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>Parentesco</span>
                      <input
                        disabled={!canManage}
                        onChange={(event) =>
                          setGuardian("relationship", event.target.value)
                        }
                        required
                        placeholder="Madre, padre o tutor"
                        value={form.guardian?.relationship ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>Teléfono</span>
                      <input
                        disabled={!canManage}
                        onChange={(event) =>
                          setGuardian("phone", event.target.value)
                        }
                        required
                        placeholder="+56 9 1234 5678"
                        value={form.guardian?.phone ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>Correo</span>
                      <input
                        disabled={!canManage}
                        onChange={(event) =>
                          setGuardian("email", event.target.value)
                        }
                        required
                        placeholder="nombre@correo.cl"
                        type="email"
                        value={form.guardian?.email ?? ""}
                      />
                    </label>
                  </div>
                </fieldset>
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
                      ? "Guardar datos"
                      : "Registrar paciente"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
