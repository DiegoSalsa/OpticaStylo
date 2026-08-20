"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import styles from "./store.module.css";

const categories = [
  { label: "Todos los productos", value: "" }, { label: "Marcos", value: "FRAME" },
  { label: "Cristales", value: "PRESCRIPTION_LENS" }, { label: "Tratamientos", value: "TREATMENT" },
  { label: "Accesorios", value: "ACCESSORY" }, { label: "Otros", value: "OTHER" },
];
const categoryNames = Object.fromEntries(categories.map(({ label, value }) => [value, label]));

function formatPrice(value) { return new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" }).format(value); }
function ProductVisual({ category }) { return category === "FRAME" ? <div className={styles.frameVisual} aria-hidden="true"><span /><i /><span /></div> : <div className={styles.categoryVisual} aria-hidden="true"><Icon name={category === "ACCESSORY" ? "sparkle" : "eye"} size={38} /></div>; }

async function requestProducts(category, query, signal) {
  const search = new URLSearchParams({ page: "1", pageSize: "24", search: query });
  if (category) search.set("category", category);
  const response = await fetch(`/api/store/products?${search}`, { signal });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error?.message || "No fue posible cargar el catálogo.");
  return payload.data;
}

export default function CatalogBrowser() {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState({ items: [], total: 0 });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestProducts(category, submittedQuery, controller.signal)
      .then((data) => { setResult(data); setStatus("ready"); })
      .catch((requestError) => {
        if (requestError.name === "AbortError") return;
        setError(requestError.message || "No fue posible cargar el catálogo."); setStatus("error");
      });
    return () => controller.abort();
  }, [category, reloadKey, submittedQuery]);

  function changeCategory(value) { setStatus("loading"); setError(""); setCategory(value); }
  function clearFilters() { setStatus("loading"); setError(""); setCategory(""); setQuery(""); setSubmittedQuery(""); }
  function retry() { setStatus("loading"); setError(""); setReloadKey((value) => value + 1); }
  function submitSearch(event) { event.preventDefault(); setStatus("loading"); setError(""); setSubmittedQuery(query.trim()); }

  return (
    <div className={styles.catalog}>
      <aside className={styles.filters}><h2>Categorías</h2><div className={styles.categoryList}>{categories.map((item) => <button className={category === item.value ? styles.categoryActive : ""} key={item.value} onClick={() => changeCategory(item.value)} type="button"><span>{item.label}</span>{category === item.value && <Icon name="check" size={17} />}</button>)}</div><div className={styles.availabilityNote}><Icon name="shield" /><p><strong>Disponibilidad informativa</strong>La cantidad exacta se confirmará cuando se conecte el inventario real.</p></div></aside>
      <section aria-busy={status === "loading"} className={styles.results}>
        <div className={styles.toolbar}><form className={styles.search} onSubmit={submitSearch} role="search"><Icon name="search" /><label className="sr-only" htmlFor="catalog-search">Buscar productos</label><input id="catalog-search" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o código" type="search" value={query} /><button type="submit">Buscar</button></form><p>{status === "ready" ? `${result.total} ${result.total === 1 ? "producto" : "productos"}` : status === "loading" ? "Cargando catálogo" : "Catálogo no disponible"}</p></div>
        {status === "loading" && <div className={styles.productGrid}>{Array.from({ length: 6 }, (_, index) => <div className={styles.skeleton} key={index} />)}</div>}
        {status === "error" && <div className={styles.state}><span><Icon name="shield" size={28} /></span><h2>No pudimos cargar el catálogo</h2><p>{error}</p><button className="button button--primary" onClick={retry} type="button">Intentar nuevamente</button></div>}
        {status === "ready" && result.items.length === 0 && <div className={styles.state}><span><Icon name="search" size={28} /></span><h2>No encontramos productos</h2><p>Prueba con otra búsqueda o revisa una categoría diferente.</p><button className="button button--secondary" onClick={clearFilters} type="button">Limpiar filtros</button></div>}
        {status === "ready" && result.items.length > 0 && <div className={styles.productGrid}>{result.items.map((product) => <article className={styles.productCard} key={product.id}><Link aria-label={`Ver ${product.name}`} className={styles.productImage} href={`/tienda/${product.id}`}><ProductVisual category={product.category} />{product.category === "FRAME" && <span className={styles.tryOnBadge}><Icon name="eye" size={15} /> Marco</span>}</Link><div className={styles.productBody}><p className={styles.productCategory}>{categoryNames[product.category] || "Producto"}</p><h2><Link href={`/tienda/${product.id}`}>{product.name}</Link></h2><p className={styles.sku}>Código {product.sku}</p><div className={styles.productBottom}><strong>{formatPrice(product.unitPriceCents)}</strong><span className={product.availability?.available ? styles.available : styles.unavailable}>{product.availability?.available ? "Disponible" : "Consultar"}</span></div>{product.requiresPrescription && <p className={styles.prescription}><Icon name="check" size={16} /> Requiere receta para completar la compra</p>}</div></article>)}</div>}
      </section>
    </div>
  );
}
