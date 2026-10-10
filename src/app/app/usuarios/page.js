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
import "../management.css";

const ROLES = [
  ["ADMIN", "Administración"],
  ["CLINICAL_PROFESSIONAL", "Profesional clínico"],
  ["SALES", "Ventas"],
];
const EMPTY = {
  email: "",
  firstName: "",
  isActive: true,
  lastName: "",
  password: "",
  roles: [],
};

export default function UsersPage() {
  const actor = useInternalActor();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("ready");
  const [notice, setNotice] = useState(null);
  const canCreate = actor?.permissions.includes("users.create");
  const canUpdate = actor?.permissions.includes("users.update");

  const list = usePaginatedResource("/api/users", { enabled: Boolean(actor?.permissions.includes("users.read")) });
  const { items } = list;
  const detailGate = useRef(createRequestGate());
  const saving = useRef(false);
  useEffect(() => { const gate = detailGate.current; return () => gate.cancel(); }, []);

  function select(user) {
    if (saving.current) return;
    setSelectedId(user.id);
    setForm({
      email: user.email,
      firstName: user.firstName,
      isActive: user.isActive,
      lastName: user.lastName,
      password: "",
      roles: user.roles,
    });
    setNotice(null);
  }

  function reset() {
    if (saving.current) return;
    detailGate.current.cancel();
    setStatus("ready");
    setSelectedId(null);
    setForm(EMPTY);
    setNotice(null);
  }

  function toggleRole(role) {
    setForm((current) => ({
      ...current,
      roles: current.roles.includes(role)
        ? current.roles.filter((item) => item !== role)
        : [...current.roles, role],
    }));
  }

  function search(event) {
    event.preventDefault();
    list.setFilters({ search: query.trim() });
  }
  async function submit(event) {
    event.preventDefault();
    if (saving.current || status !== "ready") return;
    saving.current = true;
    setStatus("saving");
    setNotice(null);
    const payload = {
      email: form.email,
      firstName: form.firstName,
      lastName: form.lastName,
      roles: form.roles,
      ...(selectedId
        ? { isActive: form.isActive }
        : { password: form.password }),
      ...(selectedId && form.password ? { password: form.password } : {}),
    };
    try {
      const saved = await readResponse(
        await fetch(selectedId ? `/api/users/${selectedId}` : "/api/users", {
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
          method: selectedId ? "PATCH" : "POST",
        }),
      );
      setNotice({
        kind: "success",
        text: selectedId
          ? "Usuario actualizado. Los cambios sensibles revocan sesiones existentes."
          : "Usuario creado correctamente.",
      });
      setSelectedId(saved.id);
      setForm({ ...saved, password: "" });
      list.reload();
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    } finally {
      saving.current = false;
    }
  }

  if (actor && !actor.permissions.includes("users.read")) {
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>Este módulo está reservado a Administración.</p>
      </section>
    );
  }

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Administración segura</p>
          <h1>Gestión de usuarios</h1>
          <p>Cuentas internas y roles. No existe rol Recepcionista.</p>
        </div>
        {canCreate && (
          <button
            className="app-button app-button--primary"
            disabled={status === "saving"}
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo usuario
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
          <form className="directory-search directory-search--contained" onSubmit={search}>
            <Icon name="search" />
            <input
              aria-label="Buscar usuarios"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre o correo"
              value={query}
            />
            <button className="app-button" type="submit">
              Buscar
            </button>
          </form>
          {list.status === "loading" ? (
            <p className="directory-state">Cargando usuarios…</p>
          ) : list.status === "error" ? null : !items.length ? (
            <p className="directory-state">{list.filters.search ? "No hay coincidencias para esta búsqueda." : "No hay usuarios para mostrar."}</p>
          ) : (
            <div className="management-list">
              {items.map((user) => (
                <button
                  className={
                    selectedId === user.id
                      ? "management-item active"
                      : "management-item"
                  }
                  key={user.id}
                  disabled={status === "saving"}
                  onClick={() => select(user)}
                  type="button"
                >
                  <span className="management-avatar">
                    {user.firstName.slice(0, 1)}
                    {user.lastName.slice(0, 1)}
                  </span>
                  <span>
                    <strong>
                      {user.firstName} {user.lastName}
                    </strong>
                    <small>{user.email}</small>
                    <small>{user.roles.join(" · ")}</small>
                  </span>
                  <i
                    className={
                      user.isActive ? "status-dot" : "status-dot inactive"
                    }
                    title={user.isActive ? "Activo" : "Inactivo"}
                  />
                </button>
              ))}
            </div>
          )}
          <Pagination {...list} label="usuarios" />
        </section>
        <section className="app-card management-editor">
          {!selectedId && !canCreate ? (
            <div className="directory-state">
              Selecciona un usuario para revisar sus datos.
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="editor-heading">
                <div>
                  <p className="eyebrow">
                    {selectedId ? "Editar cuenta" : "Nueva cuenta"}
                  </p>
                  <h2>
                    {selectedId
                      ? `${form.firstName} ${form.lastName}`
                      : "Crear usuario interno"}
                  </h2>
                </div>
                {selectedId && (
                  <span
                    className={
                      form.isActive
                        ? "status-chip"
                        : "status-chip status-chip--pending"
                    }
                  >
                    {form.isActive ? "Activo" : "Inactivo"}
                  </span>
                )}
              </div>
              <div className="management-fields">
                <label className="field">
                  <span>Nombre</span>
                  <input
                    disabled={status === "saving" || (!canUpdate && Boolean(selectedId))}
                    maxLength="100"
                    onChange={(event) =>
                      setForm({ ...form, firstName: event.target.value })
                    }
                    required
                    placeholder="Nombre"
                    value={form.firstName}
                  />
                </label>
                <label className="field">
                  <span>Apellido</span>
                  <input
                    disabled={status === "saving" || (!canUpdate && Boolean(selectedId))}
                    maxLength="100"
                    onChange={(event) =>
                      setForm({ ...form, lastName: event.target.value })
                    }
                    required
                    placeholder="Apellido"
                    value={form.lastName}
                  />
                </label>
                <label className="field field-wide">
                  <span>Correo</span>
                  <input
                    disabled={status === "saving" || (!canUpdate && Boolean(selectedId))}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                    required
                    placeholder="nombre@opticastylo.cl"
                    type="email"
                    value={form.email}
                  />
                </label>
                <label className="field field-wide">
                  <span>
                    {selectedId
                      ? "Nueva contraseña (opcional)"
                      : "Contraseña temporal"}
                  </span>
                  <input
                    autoComplete="new-password"
                    disabled={status === "saving" || (!canUpdate && Boolean(selectedId))}
                    minLength="15"
                    onChange={(event) =>
                      setForm({ ...form, password: event.target.value })
                    }
                    placeholder={
                      selectedId
                        ? "Déjala vacía para conservarla"
                        : "Mínimo 15 caracteres"
                    }
                    required={!selectedId}
                    type="password"
                    value={form.password}
                  />
                </label>
              </div>
              <fieldset className="role-picker">
                <legend>Roles</legend>
                {ROLES.map(([code, label]) => (
                  <label key={code}>
                    <input
                      checked={form.roles.includes(code)}
                      disabled={
                        status === "saving" || !actor?.permissions.includes("users.assign_roles")
                      }
                      onChange={() => toggleRole(code)}
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              {selectedId && (
                <label className="active-switch">
                  <input
                    checked={form.isActive}
                    disabled={
                      status === "saving" || !actor?.permissions.includes("users.deactivate") ||
                      selectedId === actor.userId
                    }
                    onChange={(event) =>
                      setForm({ ...form, isActive: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span>Cuenta activa</span>
                  <small>
                    {selectedId === actor.userId
                      ? "No puedes desactivar tu propia sesión."
                      : "Al cambiar el estado se revocan las sesiones existentes."}
                  </small>
                </label>
              )}
              <div className="editor-actions">
                <button
                  className="app-button app-button--primary"
                  disabled={
                    status === "saving" ||
                    form.roles.length === 0 ||
                    (selectedId ? !canUpdate : !canCreate)
                  }
                  type="submit"
                >
                  {status === "saving"
                    ? "Guardando…"
                    : selectedId
                      ? "Guardar cambios"
                      : "Crear usuario"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
