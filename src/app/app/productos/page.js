"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

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
  const [imageAlt, setImageAlt] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [images, setImages] = useState([]);
  const [imageStatus, setImageStatus] = useState("idle");
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

  const loadImages = useCallback(async (productId) => {
    try {
      const data = await readResponse(await fetch(`/api/products/${productId}/images`, {
        cache: "no-store",
      }));
      setImages(data);
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }, []);

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
    setImages([]);
    setImageAlt("");
    setImageFile(null);
    setNotice(null);
    void loadImages(product.id);
  }

  function reset() {
    setSelectedId(null);
    setForm(EMPTY);
    setImages([]);
    setImageAlt("");
    setImageFile(null);
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
      void loadImages(saved.id);
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

  async function uploadImage(event) {
    event.preventDefault();
    if (!selectedId || !imageFile) return;
    setImageStatus("uploading");
    setNotice(null);
    const payload = new FormData();
    payload.set("alt", imageAlt);
    payload.set("image", imageFile);
    try {
      const created = await readResponse(await fetch(`/api/products/${selectedId}/images`, {
        body: payload,
        method: "POST",
      }));
      setImages((current) => [...current, created]);
      setImageAlt("");
      setImageFile(null);
      setImageStatus("idle");
      setNotice({ kind: "success", text: "Imagen guardada en Cloudinary." });
    } catch (error) {
      setImageStatus("idle");
      setNotice({ kind: "error", text: error.message });
    }
  }

  async function removeImage(imageId) {
    if (!selectedId) return;
    setImageStatus(`removing:${imageId}`);
    setNotice(null);
    try {
      await readResponse(await fetch(`/api/products/${selectedId}/images/${imageId}`, {
        method: "DELETE",
      }));
      setImages((current) => current.filter((image) => image.id !== imageId));
      setNotice({ kind: "success", text: "Imagen retirada del catálogo." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setImageStatus("idle");
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
                      {product.requiresPrescription ? " · Receta opcional" : ""}
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
                    onChange={(event) => {
                      const category = event.target.value;
                      setForm({
                        ...form,
                        category,
                        requiresPrescription: category === "PRESCRIPTION_LENS"
                          ? form.requiresPrescription
                          : false,
                      });
                    }}
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
                  disabled={!canManage || form.category !== "PRESCRIPTION_LENS"}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      requiresPrescription: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span>Exige receta antes de vender</span>
                <small>
                  Solo aplica a cristales ópticos. El marco siempre puede venderse
                  con o sin receta.
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
              {selectedId && (
                <section className="product-image-manager" aria-labelledby="product-images-heading">
                  <div>
                    <h3 id="product-images-heading">Galería del producto</h3>
                    <p>Las imágenes se almacenan y entregan desde Cloudinary.</p>
                  </div>
                  {images.length > 0 && (
                    <div className="product-image-grid">
                      {images.map((image) => (
                        <article className="product-image-card" key={image.id}>
                          <div className="product-image-preview">
                            <Image
                              alt={image.alt}
                              fill
                              sizes="(max-width: 900px) 45vw, 180px"
                              src={image.url}
                              unoptimized
                            />
                          </div>
                          <div>
                            <span>{image.alt}</span>
                            {canManage && (
                              <button
                                className="app-button app-button--quiet"
                                disabled={imageStatus !== "idle"}
                                onClick={() => removeImage(image.id)}
                                type="button"
                              >
                                {imageStatus === `removing:${image.id}` ? "Retirando…" : "Retirar"}
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {canManage && (
                    <form className="product-image-upload" onSubmit={uploadImage}>
                      <label className="field field-wide">
                        <span>Imagen</span>
                        <input
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                          required
                          type="file"
                        />
                        <small>JPEG, PNG, WEBP, HEIC o HEIF; máximo 4 MiB.</small>
                      </label>
                      <label className="field field-wide">
                        <span>Descripción de la imagen</span>
                        <input
                          maxLength="300"
                          onChange={(event) => setImageAlt(event.target.value)}
                          placeholder="Ejemplo: Vista frontal de la montura negra"
                          required
                          value={imageAlt}
                        />
                      </label>
                      <button
                        className="app-button"
                        disabled={!imageFile || imageStatus !== "idle"}
                        type="submit"
                      >
                        {imageStatus === "uploading" ? "Subiendo…" : "Agregar imagen"}
                      </button>
                    </form>
                  )}
                </section>
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
