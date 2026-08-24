"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import styles from "./store.module.css";

const categories = [
  { label: "Todos", value: "" }, { label: "Marcos", value: "FRAME" },
  { label: "Tratamientos", value: "TREATMENT" },
  { label: "Accesorios", value: "ACCESSORY" }, { label: "Otros", value: "OTHER" },
];
const categoryNames = Object.fromEntries(categories.map(({ label, value }) => [value, label]));

function formatPrice(value) { return new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" }).format(value); }
function ProductVisual({ product }) {
  const image = product.images?.[0];
  if (image) return <Image alt={image.alt} className={styles.productPhoto} fill sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 33vw" src={image.url} />;
  return product.category === "FRAME" ? <div className={styles.frameVisual} aria-hidden="true"><span /><i /><span /></div> : <div className={styles.categoryVisual} aria-hidden="true"><Icon name={product.category === "ACCESSORY" ? "sparkle" : "eye"} size={38} /></div>;
}

async function requestProducts(category, query, signal) {
  const search = new URLSearchParams({ page: "1", pageSize: "24", search: query });
  if (category) search.set("category", category);
  const response = await fetch(`/api/store/products?${search}`, { signal });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error?.message || "No fue posible cargar el catálogo.");
  return payload.data;
}

export default function CatalogBrowser({ initialCategory = "" }) {
  const validInitialCategory = categories.some((item) => item.value === initialCategory) ? initialCategory : "";
  const [category, setCategory] = useState(validInitialCategory);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [prescription, setPrescription] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [sort, setSort] = useState("featured");
  const [view, setView] = useState("grid");
  const [result, setResult] = useState({ items: [], total: 0 });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestProducts(category, submittedQuery, controller.signal)
      .then((data) => { setResult(data); setStatus("ready"); })
      .catch((requestError) => { if (requestError.name !== "AbortError") { setError(requestError.message || "No fue posible cargar el catálogo."); setStatus("error"); } });
    return () => controller.abort();
  }, [category, reloadKey, submittedQuery]);

  const visibleItems = useMemo(() => {
    const filtered = result.items.filter((product) => {
      if (prescription === "required" && !product.requiresPrescription) return false;
      if (prescription === "not-required" && product.requiresPrescription) return false;
      if (availability === "available" && !product.availability?.available) return false;
      return true;
    });
    if (sort === "price-asc") return filtered.toSorted((a, b) => a.unitPriceCents - b.unitPriceCents);
    if (sort === "price-desc") return filtered.toSorted((a, b) => b.unitPriceCents - a.unitPriceCents);
    return filtered;
  }, [availability, prescription, result.items, sort]);

  function changeCategory(value) { setStatus("loading"); setError(""); setCategory(value); }
  function clearFilters() { setStatus("loading"); setError(""); setCategory(""); setQuery(""); setSubmittedQuery(""); setPrescription("all"); setAvailability("all"); setSort("featured"); }
  function retry() { setStatus("loading"); setError(""); setReloadKey((value) => value + 1); }
  function submitSearch(event) { event.preventDefault(); setStatus("loading"); setError(""); setSubmittedQuery(query.trim()); }

  return <div className={styles.catalog}>
    <aside className={styles.filters}>
      <div className={styles.filterTitle}><h2>Filtros</h2><button onClick={clearFilters} type="button">Limpiar</button></div>
      <fieldset><legend>Categoría</legend><div className={styles.categoryList}>{categories.map((item) => <button aria-pressed={category === item.value} className={category === item.value ? styles.categoryActive : ""} key={item.value} onClick={() => changeCategory(item.value)} type="button"><span>{item.label}</span>{category === item.value && <Icon name="check" size={16} />}</button>)}</div></fieldset>
      <fieldset><legend>Receta</legend><label><input checked={prescription === "all"} name="prescription" onChange={() => setPrescription("all")} type="radio" /> Todos</label><label><input checked={prescription === "required"} name="prescription" onChange={() => setPrescription("required")} type="radio" /> Con receta opcional</label><label><input checked={prescription === "not-required"} name="prescription" onChange={() => setPrescription("not-required")} type="radio" /> Sin opción de receta</label></fieldset>
      <fieldset><legend>Disponibilidad</legend><label><input checked={availability === "available"} onChange={(event) => setAvailability(event.target.checked ? "available" : "all")} type="checkbox" /> Mostrar disponibles</label></fieldset>
      <div className={styles.availabilityNote}><Icon name="shield" /><p><strong>Stock informativo</strong>La cantidad exacta se confirmará cuando se conecte el inventario real en la etapa 6.</p></div>
    </aside>

    <section aria-busy={status === "loading"} className={styles.results}>
      <form className={styles.search} onSubmit={submitSearch} role="search"><Icon name="search" /><label className="sr-only" htmlFor="catalog-search">Buscar productos</label><input id="catalog-search" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por modelo, marca o característica..." type="search" value={query} /><button type="submit">Buscar</button></form>
      <div className={styles.toolbar}><p>{status === "ready" ? <>Mostrando <strong>{result.total}</strong> productos</> : "Cargando catálogo"}</p><div><label><span>Ordenar por</span><select onChange={(event) => setSort(event.target.value)} value={sort}><option value="featured">Recomendados</option><option value="price-asc">Menor precio</option><option value="price-desc">Mayor precio</option><option value="newest">Novedades</option></select></label><div className={styles.viewSwitch}><button aria-label="Vista en cuadrícula" aria-pressed={view === "grid"} onClick={() => setView("grid")} type="button">▦</button><button aria-label="Vista en lista" aria-pressed={view === "list"} onClick={() => setView("list")} type="button">☰</button></div></div></div>
      {status === "loading" && <div className={styles.productGrid}>{Array.from({ length: 6 }, (_, index) => <div className={styles.skeleton} key={index} />)}</div>}
      {status === "error" && <div className={styles.state}><span><Icon name="shield" size={28} /></span><h2>No pudimos cargar el catálogo</h2><p>{error}</p><button className="button button--primary" onClick={retry} type="button">Intentar nuevamente</button></div>}
      {status === "ready" && visibleItems.length === 0 && <div className={styles.state}><span><Icon name="search" size={28} /></span><h2>No encontramos productos</h2><p>Prueba con otra búsqueda o cambia los filtros disponibles.</p><button className="button button--secondary" onClick={clearFilters} type="button">Limpiar filtros</button></div>}
      {status === "ready" && visibleItems.length > 0 && <div className={`${styles.productGrid} ${view === "list" ? styles.productList : ""}`}>{visibleItems.map((product) => <article className={styles.productCard} key={product.id}><Link aria-label={`Ver ${product.name}`} className={styles.productImage} href={`/tienda/${product.id}`}><ProductVisual product={product} />{product.category === "FRAME" && <span className={styles.tryOnBadge}><Icon name="eye" size={15} /> Prueba virtual</span>}</Link><div className={styles.productBody}><p className={styles.productCategory}>{categoryNames[product.category] || "Producto"}</p><h2><Link href={`/tienda/${product.id}`}>{product.name}</Link></h2><p className={styles.sku}>Código {product.sku}</p><div className={styles.productBottom}><strong>{formatPrice(product.unitPriceCents)}</strong><span className={product.availability?.available ? styles.available : styles.unavailable}>{product.availability?.available ? "Disponible" : "Consultar"}</span></div>{product.requiresPrescription && <p className={styles.prescription}><Icon name="file" size={15} /> Receta opcional</p>}<Link className={styles.productAction} href={`/tienda/${product.id}`}>Ver producto <Icon name="arrow" size={17} /></Link></div></article>)}</div>}
      {status === "ready" && result.total > result.items.length && <p className={styles.pageNote}>Mostrando los primeros {result.items.length} de {result.total} productos publicados.</p>}
    </section>
  </div>;
}
