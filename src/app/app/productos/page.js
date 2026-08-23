"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import "../management.css";

const CATEGORIES = [
  ["FRAME", "Marco"],
  ["PRESCRIPTION_LENS", "Opción de cristales"],
  ["TREATMENT", "Tratamiento"],
  ["ACCESSORY", "Accesorio"],
  ["OTHER", "Otro"],
];
const EMPTY = {
  category: "FRAME",
  isActive: true,
  name: "",
  requiresPrescription: false,
  sku: "",
  unitPriceCents: "",
};
const money = new Intl.NumberFormat("es-CL", {
  currency: "CLP",
  maximumFractionDigits: 0,
  style: "currency",
});

export default function ProductsPage() {
  const actor = useInternalActor();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const canManage = actor?.permissions.includes("products.manage");
  const requestProducts = useCallback(
    async (signal) =>
      readResponse(
        await fetch(
          `/api/products?search=${encodeURIComponent(submitted)}&pageSize=100`,
          { cache: "no-store", signal },
        ),
      ),
    [submitted],
  );

  useEffect(() => {
    if (!actor?.permissions.includes("products.read")) return;
    const controller = new AbortController();
    requestProducts(controller.signal)
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
  }, [actor, requestProducts]);

  function select(product) {
    setSelectedId(product.id);
    setForm({ ...product, unitPriceCents: String(product.unitPriceCents) });
    setNotice(null);
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
      const data = await requestProducts();
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
    try {
      const saved = await readResponse(
        await fetch(
          selectedId ? `/api/products/${selectedId}` : "/api/products",
          {
            body: JSON.stringify({
              category: form.category,
              ...(selectedId ? { isActive: form.isActive } : {}),
              name: form.name,
              requiresPrescription: form.requiresPrescription,
              sku: form.sku,
              unitPriceCents: Number(form.unitPriceCents),
            }),
            headers: { "Content-Type": "application/json" },
            method: selectedId ? "PATCH" : "POST",
          },
        ),
      );
      setSelectedId(saved.id);
      setForm({ ...saved, unitPriceCents: String(saved.unitPriceCents) });
      const data = await requestProducts();
      setItems(data.items);
      setStatus("ready");
      setNotice({
        kind: "success",
        text: selectedId
          ? "Producto actualizado y cambio auditado."
          : "Producto creado correctamente.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    }
  }

  if (actor && !actor.permissions.includes("products.read")) {
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>No tienes permiso para consultar el catálogo.</p>
      </section>
    );
  }

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Catálogo comercial</p>
          <h1>Catálogo e inventario</h1>
          <p>
            Productos reales registrados. El stock exacto sigue simulado hasta
            la etapa 6.
          </p>
        </div>
        {canManage && (
          <button
            className="app-button app-button--primary"
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo producto
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
              aria-label="Buscar productos"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre o SKU"
              value={query}
            />
            <button className="app-button" type="submit">
              Buscar
            </button>
          </form>
          {status === "loading" ? (
            <p className="directory-state">Cargando productos…</p>
          ) : !items.length ? (
            <p className="directory-state">No hay productos registrados.</p>
          ) : (
            <div className="management-list">
              {items.map((product) => (
                <button
                  className={
                    selectedId === product.id
                      ? "management-item active"
                      : "management-item"
                  }
                  key={product.id}
                  onClick={() => select(product)}
                  type="button"
                >
                  <span className="management-avatar">
                    <Icon
                      name={product.category === "FRAME" ? "eye" : "package"}
                      size={18}
                    />
                  </span>
                  <span>
                    <strong>{product.name}</strong>
                    <small>
                      {product.sku} ·{" "}
                      {
                        CATEGORIES.find(
                          ([code]) => code === product.category,
                        )?.[1]
                      }
                    </small>
                    <small>
                      {money.format(product.unitPriceCents)}
                      {product.requiresPrescription ? " · Requiere receta" : ""}
                    </small>
                  </span>
                  <i
                    className={
                      product.isActive ? "status-dot" : "status-dot inactive"
                    }
                    title={product.isActive ? "Activo" : "Inactivo"}
                  />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="app-card management-editor">
          {!selectedId && !canManage ? (
            <div className="directory-state">
              Selecciona un producto para revisar sus datos.
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="editor-heading">
                <div>
                  <p className="eyebrow">
                    {selectedId ? "Editar producto" : "Alta de producto"}
                  </p>
                  <h2>{selectedId ? form.name : "Nuevo producto"}</h2>
                </div>
                {selectedId && (
                  <span
                    className={
                      form.isActive
                        ? "status-chip"
                        : "status-chip status-chip--pending"
                    }
                  >
                    {form.isActive ? "En catálogo" : "Inactivo"}
                  </span>
                )}
              </div>
              <div className="management-fields">
                <label className="field field-wide">
                  <span>Nombre comercial</span>
                  <input
                    disabled={!canManage}
                    maxLength="200"
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    required
                    value={form.name}
                  />
                </label>
                <label className="field">
                  <span>SKU</span>
                  <input
                    disabled={!canManage}
                    maxLength="80"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        sku: event.target.value.toUpperCase(),
                      })
                    }
                    required
                    value={form.sku}
                  />
                </label>
                <label className="field">
                  <span>Categoría</span>
                  <select
                    disabled={!canManage}
                    onChange={(event) =>
                      setForm({ ...form, category: event.target.value })
                    }
                    value={form.category}
                  >
                    {CATEGORIES.map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Precio publicado (CLP)</span>
                  <input
                    disabled={!canManage}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) =>
                      setForm({ ...form, unitPriceCents: event.target.value })
                    }
                    required
                    step="1"
                    type="number"
                    value={form.unitPriceCents}
                  />
                  <small>
                    Se registra en pesos chilenos enteros. Adicionales ópticos
                    se cobran como productos separados.
                  </small>
                </label>
              </div>
              <label className="active-switch">
                <input
                  checked={form.requiresPrescription}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      requiresPrescription: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span>Requiere receta para completar la venta</span>
                <small>
                  Los marcos pueden venderse sin receta; actívalo solo cuando el
                  lente o producto la necesite.
                </small>
              </label>
              {selectedId && (
                <label className="active-switch">
                  <input
                    checked={form.isActive}
                    disabled={!canManage}
                    onChange={(event) =>
                      setForm({ ...form, isActive: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span>Producto visible y vendible</span>
                  <small>
                    Desactivar conserva historial de ventas y versiones.
                  </small>
                </label>
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
                      : "Crear producto"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
