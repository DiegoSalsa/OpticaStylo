"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
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
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const canCreate = actor?.permissions.includes("users.create");
  const canUpdate = actor?.permissions.includes("users.update");

  const requestUsers = useCallback(
    async (signal) =>
      readResponse(
        await fetch(
          `/api/users?search=${encodeURIComponent(submitted)}&pageSize=100`,
          { cache: "no-store", signal },
        ),
      ),
    [submitted],
  );

  useEffect(() => {
    if (!actor?.permissions.includes("users.read")) return;
    const controller = new AbortController();
    requestUsers(controller.signal)
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
  }, [actor, requestUsers]);

  function select(user) {
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

  async function search(event) {
    event.preventDefault();
    const normalized = query.trim();
    setStatus("loading");
    if (normalized !== submitted) {
      setSubmitted(normalized);
      return;
    }
    try {
      const data = await requestUsers();
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
      const data = await requestUsers();
      setItems(data.items);
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
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
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo usuario
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
              aria-label="Buscar usuarios"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre o correo"
              value={query}
            />
            <button className="app-button" type="submit">
              Buscar
            </button>
          </form>
          {status === "loading" ? (
            <p className="directory-state">Cargando usuarios…</p>
          ) : !items.length ? (
            <p className="directory-state">No hay usuarios para mostrar.</p>
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
                    disabled={!canUpdate && Boolean(selectedId)}
                    maxLength="100"
                    onChange={(event) =>
                      setForm({ ...form, firstName: event.target.value })
                    }
                    required
                    value={form.firstName}
                  />
                </label>
                <label className="field">
                  <span>Apellido</span>
                  <input
                    disabled={!canUpdate && Boolean(selectedId)}
                    maxLength="100"
                    onChange={(event) =>
                      setForm({ ...form, lastName: event.target.value })
                    }
                    required
                    value={form.lastName}
                  />
                </label>
                <label className="field field-wide">
                  <span>Correo</span>
                  <input
                    disabled={!canUpdate && Boolean(selectedId)}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                    required
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
                    disabled={!canUpdate && Boolean(selectedId)}
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
                        !actor?.permissions.includes("users.assign_roles")
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
                      !actor?.permissions.includes("users.deactivate") ||
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
