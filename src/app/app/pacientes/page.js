"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
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
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const canManage = actor?.permissions.includes("patients.manage_basic");
  const minor = useMemo(() => isMinor(form.birthDate), [form.birthDate]);
  const requestPatients = useCallback(
    async (signal) =>
      readResponse(
        await fetch(
          `/api/patients?search=${encodeURIComponent(submitted)}&pageSize=100`,
          { cache: "no-store", signal },
        ),
      ),
    [submitted],
  );

  useEffect(() => {
    if (!actor?.permissions.includes("patients.read_basic")) return;
    const controller = new AbortController();
    requestPatients(controller.signal)
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
  }, [actor, requestPatients]);

  async function select(patient) {
    setSelectedId(patient.id);
    setStatus("loading-detail");
    setNotice(null);
    try {
      const detail = await readResponse(
        await fetch(`/api/patients/${patient.id}`, { cache: "no-store" }),
      );
      setForm({
        ...detail,
        guardian: detail.guardian ? { ...detail.guardian } : null,
      });
      setStatus("ready");
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
      const data = await requestPatients();
      setItems(data.items);
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("error");
    }
  }
  function setGuardian(field, value) {
    setForm((current) => ({
      ...current,
      guardian: { ...(current.guardian ?? EMPTY_GUARDIAN), [field]: value },
    }));
  }
  async function submit(event) {
    event.preventDefault();
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
      const data = await requestPatients();
      setItems(data.items);
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
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo paciente
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
              aria-label="Buscar pacientes"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre, RUT, correo o teléfono"
              value={query}
            />
            <button className="app-button" type="submit">
              Buscar
            </button>
          </form>
          {status === "loading" ? (
            <p className="directory-state">Cargando pacientes…</p>
          ) : !items.length ? (
            <p className="directory-state">No hay pacientes registrados.</p>
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
        </section>
        <section className="app-card management-editor">
          {status === "loading-detail" ? (
            <p className="directory-state">Cargando ficha básica…</p>
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
