"use client";

import Image from "next/image";

import Pagination from "@/components/internal/pagination";
import Icon from "@/components/ui/icon";

export default function ProductCatalogInterface({ model }) {
  const {
    list,
    imageError,
    fileRevision,
    retryImages,
    CATEGORIES,
    canManage,
    form,
    imageAlt,
    imageFile,
    imageStatus,
    images,
    items,
    money,
    notice,
    query,
    removeImage,
    reset,
    search,
    select,
    selectedId,
    setForm,
    setImageAlt,
    setImageFile,
    setQuery,
    status,
    submit,
    uploadImage,
  } = model;

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Catálogo comercial</p>
          <h1>Catálogo de productos</h1>
          <p>
            Administra los productos, precios e imágenes publicados en la tienda.
          </p>
        </div>
        {canManage && (
          <button
            className="app-button app-button--primary"
            disabled={status === "saving" || imageStatus === "uploading" || imageStatus.startsWith("removing:")}
            onClick={reset}
            type="button"
          >
            <Icon name="plus" size={16} /> Nuevo producto
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
          {/* Mantener el buscador del catálogo alineado en escritorio */}
          <form
            className="directory-search product-catalog-search"
            onSubmit={search}
          >
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
          <div className="directory-filters">
            <label className="field"><span>Categoría del listado</span><select value={list.filters.category ?? ""} onChange={(event) => list.setFilters({ category: event.target.value })}><option value="">Todas</option>{CATEGORIES.map(([code,label]) => <option value={code} key={code}>{label}</option>)}</select></label>
            <label className="field"><span>Estado del listado</span><select value={list.filters.isActive ?? ""} onChange={(event) => list.setFilters({ isActive: event.target.value })}><option value="">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select></label>
          </div>
          {list.status === "loading" ? (
            <p className="directory-state">Cargando productos…</p>
          ) : list.status === "error" ? null : !items.length ? (
            <p className="directory-state">{Object.values(list.filters).some(Boolean) ? "No hay coincidencias para estos filtros." : "No hay productos registrados."}</p>
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
                  disabled={status === "saving" || imageStatus === "uploading" || imageStatus.startsWith("removing:")}
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
          <Pagination {...list} label="productos" />
        </section>
        <section className="app-card management-editor">
          {!selectedId && !canManage ? (
            <div className="directory-state">
              Selecciona un producto para revisar sus datos.
            </div>
          ) : (
            <>
            <form aria-label="Editar producto" onSubmit={submit}>
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
                    disabled={!canManage || status === "saving"}
                    maxLength="200"
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    required
                    placeholder="Nombre del producto"
                    value={form.name}
                  />
                </label>
                <label className="field">
                  <span>SKU</span>
                  <input
                    disabled={!canManage || status === "saving"}
                    maxLength="80"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        sku: event.target.value.toUpperCase(),
                      })
                    }
                    required
                    placeholder="Ej: MARCO-001"
                    value={form.sku}
                  />
                </label>
                <label className="field">
                  <span>Categoría</span>
                  <select
                    disabled={!canManage || status === "saving"}
                    onChange={(event) => {
                      const category = event.target.value;
                      setForm({
                        ...form,
                        category,
                        requiresPrescription:
                          category === "PRESCRIPTION_LENS"
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
                    disabled={!canManage || status === "saving"}
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
                  disabled={!canManage || status === "saving" || form.category !== "PRESCRIPTION_LENS"}
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
                  Solo aplica a cristales ópticos. El marco siempre puede
                  venderse con o sin receta.
                </small>
              </label>
              {selectedId && (
                <label className="active-switch">
                  <input
                    checked={form.isActive}
                    disabled={!canManage || status === "saving"}
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
              {selectedId && (
                <section
                  className="product-image-manager"
                  aria-labelledby="product-images-heading"
                >
                  <div>
                    <h3 id="product-images-heading">Galería del producto</h3>
                    <p>
                      Las imágenes se almacenan y entregan desde Cloudinary.
                    </p>
                  </div>
                  {imageStatus === "loading" && <p role="status">Cargando imágenes…</p>}
                  {imageError && <p className="inline-error" role="alert">{imageError} <button className="app-button" onClick={retryImages} type="button">Reintentar</button></p>}
                  {imageStatus === "idle" && !images.length && <p>No hay imágenes registradas.</p>}
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
                                {imageStatus === `removing:${image.id}`
                                  ? "Retirando…"
                                  : "Retirar"}
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {canManage && (
                    <form
                      aria-label="Subir imagen"
                      className="product-image-upload"
                      onSubmit={uploadImage}
                    >
                      <label className="field field-wide">
                        <span>Imagen</span>
                        <input
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          aria-label="Imagen del producto"
                          aria-describedby="product-image-file-help"
                          onChange={(event) =>
                            setImageFile(event.target.files?.[0] ?? null)
                          }
                          required
                          disabled={imageStatus === "uploading"}
                          key={`${selectedId}:${fileRevision}`}
                          type="file"
                        />
                        <small id="product-image-file-help">
                          JPEG, PNG, WEBP, HEIC o HEIF; máximo 4 MiB.
                        </small>
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
                        {imageStatus === "uploading"
                          ? "Subiendo…"
                          : "Agregar imagen"}
                      </button>
                    </form>
                  )}
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
