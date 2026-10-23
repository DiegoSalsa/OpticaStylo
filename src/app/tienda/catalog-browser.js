"use client";

import CloudinaryProductImage from "@/components/store/cloudinary-product-image";
import Link from "next/link";
import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/ui/icon";
import { readStoreCatalogQuery, storeCatalogParams } from "@/utils/store-catalog-query";
import styles from "./store.module.css";

const categories = [
  { label: "Todos", value: "" }, { label: "Marcos", value: "FRAME" },
  { label: "Tratamientos", value: "TREATMENT" },
  { label: "Accesorios", value: "ACCESSORY" }, { label: "Otros", value: "OTHER" },
];
const categoryNames = Object.fromEntries(categories.map(({ label, value }) => [value, label]));

// Los importes del catálogo ya vienen expresados en pesos chilenos desde el servidor.
function formatPrice(value) { return new Intl.NumberFormat("es-CL", { currency: "CLP", maximumFractionDigits: 0, style: "currency" }).format(value); }
// Mantener la proporción del producto y una alternativa cuando no existe fotografía.
function ProductVisual({ product }) {
  const image = product.images?.[0];
  const fallback = <><span className={styles.photoPending}>Fotografía oficial pendiente</span>{product.category === "FRAME" ? <div className={styles.frameVisual} aria-hidden="true"><span /><i /><span /></div> : <div className={styles.categoryVisual} aria-hidden="true"><Icon name={product.category === "ACCESSORY" ? "sparkle" : "eye"} size={38} /></div>}</>;
  return <CloudinaryProductImage image={image} className={styles.productPhoto} sizes="(max-width: 720px) 100vw, (max-width: 1100px) 50vw, 33vw">{fallback}</CloudinaryProductImage>;
}

// Limitar la espera también cuando la red no responde; el reintento conserva los filtros.
async function requestProducts(search, signal) {
  const response = await fetch(`/api/store/products?${search}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error?.message || "No fue posible cargar el catálogo.");
  return payload.data;
}

// El borrador de búsqueda se reinicia con la URL, sin sobrescribir mientras se escribe.
function CatalogSearch({ search, onSearch }) {
  const [query, setQuery] = useState(search);
  return <form className={styles.search} onSubmit={(event) => { event.preventDefault(); onSearch(query.trim()); }} role="search"><Icon name="search" /><label className="sr-only" htmlFor="catalog-search">Buscar productos en el catálogo</label><input id="catalog-search" maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por modelo, marca o SKU..." type="search" value={query} /><button type="submit">Buscar</button></form>;
}

export default function CatalogBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawQuery = searchParams.toString();
  const filters = useMemo(() => readStoreCatalogQuery(new URLSearchParams(rawQuery)), [rawQuery]);
  const [displayFilters, showFilters] = useOptimistic(filters);
  const [navigating, startNavigation] = useTransition();
  const { category, search, prescription, availability, sort, page } = displayFilters;
  const canonicalQuery = storeCatalogParams(filters).toString();
  const apiParams = new URLSearchParams(canonicalQuery);
  apiParams.set("pageSize", "24");
  const apiQuery = apiParams.toString();
  const [view, setView] = useState("grid");
  const [response, setResponse] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${apiQuery}:${reloadKey}`;
  const status = !navigating && response?.key === requestKey ? response.status : "loading";
  const result = status === "ready" ? response.result : { items: [], total: 0 };
  const error = status === "error" ? response.error : "";

  useEffect(() => {
    const controller = new AbortController();
    // La clave y la cancelación impiden que una respuesta antigua reemplace otra búsqueda.
    requestProducts(apiQuery, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResponse({ key: requestKey, status: "ready", result: data }); })
      .catch(() => { if (!controller.signal.aborted) setResponse({ key: requestKey, status: "error", error: "Revisa tu conexión e intenta nuevamente." }); });
    return () => controller.abort();
  }, [apiQuery, requestKey]);

  // Ajustar enlaces a páginas que dejaron de existir después de cambiar el catálogo.
  useEffect(() => {
    if (status === "ready" && page > Math.max(1, result.totalPages)) {
      const params = new URLSearchParams(canonicalQuery);
      const lastPage = Math.max(1, result.totalPages);
      if (lastPage === 1) params.delete("page"); else params.set("page", String(lastPage));
      router.replace(`/tienda${params.size ? `?${params}` : ""}`, { scroll: false });
    }
  }, [canonicalQuery, page, result.totalPages, router, status]);

  // Una acción idéntica no inicia otra carga; cada filtro nuevo vuelve a la primera página.
  function changeFilters(change) {
    const nextFilters = { ...displayFilters, page: 1, ...change };
    const next = storeCatalogParams(nextFilters).toString();
    if (next !== canonicalQuery) startNavigation(() => {
      // Reflejar radios y casillas de inmediato mientras Next confirma la nueva URL.
      showFilters(nextFilters);
      router.push(`/tienda${next ? `?${next}` : ""}`, { scroll: false });
    });
  }
  function clearFilters() { changeFilters({ category: "", search: "", prescription: "all", availability: "all", sort: "featured" }); }
  function retry() { setReloadKey((value) => value + 1); }
  const visibleItems = result.items;

  return <div className={styles.catalog}>
    <aside className={styles.filters}>
      <div className={styles.filterTitle}><h2>Filtros</h2><button onClick={clearFilters} type="button">Limpiar</button></div>
      <fieldset><legend>Categoría</legend><div className={styles.categoryList}>{categories.map((item) => <button aria-pressed={category === item.value} className={category === item.value ? styles.categoryActive : ""} key={item.value} onClick={() => changeFilters({ category: item.value })} type="button"><span>{item.label}</span>{category === item.value && <Icon name="check" size={16} />}</button>)}</div></fieldset>
      <fieldset><legend>Receta</legend><label><input checked={prescription === "all"} name="prescription" onChange={() => changeFilters({ prescription: "all" })} type="radio" /> Todos</label><label><input checked={prescription === "optional"} name="prescription" onChange={() => changeFilters({ prescription: "optional" })} type="radio" /> Con receta opcional</label><label><input checked={prescription === "not-required"} name="prescription" onChange={() => changeFilters({ prescription: "not-required" })} type="radio" /> Sin opción de receta</label></fieldset>
      <fieldset><legend>Disponibilidad</legend><label><input checked={availability === "available"} onChange={(event) => changeFilters({ availability: event.target.checked ? "available" : "all" })} type="checkbox" /> Mostrar disponibles</label></fieldset>
      <div className={styles.availabilityNote}><Icon name="shield" /><p><strong>Disponibilidad referencial</strong>La confirmación final se realiza al preparar el pedido.</p></div>
    </aside>

    <section aria-busy={status === "loading"} className={styles.results}>
      <CatalogSearch key={search} search={search} onSearch={(value) => changeFilters({ search: value })} />
      <div className={styles.toolbar}><p role="status" aria-live="polite">{status === "ready" ? <>Mostrando <strong>{result.total ? (page - 1) * 24 + 1 : 0}–{Math.min(page * 24, result.total)}</strong> de {result.total} productos</> : status === "error" ? "Catálogo no disponible" : "Cargando catálogo…"}</p><div><label><span>Ordenar por</span><select onChange={(event) => changeFilters({ sort: event.target.value })} value={sort}><option value="featured">Nombre y categoría</option><option value="price-asc">Menor precio</option><option value="price-desc">Mayor precio</option><option value="newest">Novedades</option></select></label><div className={styles.viewSwitch}><button aria-label="Vista en cuadrícula" aria-pressed={view === "grid"} onClick={() => setView("grid")} type="button">▦</button><button aria-label="Vista en lista" aria-pressed={view === "list"} onClick={() => setView("list")} type="button">☰</button></div></div></div>
      {status === "loading" && <div className={styles.productGrid}>{Array.from({ length: 6 }, (_, index) => <div className={styles.skeleton} key={index} />)}</div>}
      {status === "error" && <div className={styles.state}><span><Icon name="shield" size={28} /></span><h2>No pudimos cargar el catálogo</h2><p>{error}</p><button className="button button--primary" onClick={retry} type="button">Intentar nuevamente</button></div>}
      {status === "ready" && visibleItems.length === 0 && <div className={styles.state}><span><Icon name="search" size={28} /></span><h2>No encontramos productos</h2><p>Prueba con otra búsqueda o cambia los filtros disponibles.</p><button className="button button--secondary" onClick={clearFilters} type="button">Limpiar filtros</button></div>}
      {status === "ready" && visibleItems.length > 0 && <div className={`${styles.productGrid} ${view === "list" ? styles.productList : ""}`}>{visibleItems.map((product) => <article className={styles.productCard} key={product.id}><Link aria-label={`Ver ${product.name}`} className={styles.productImage} href={`/tienda/${product.id}`}><ProductVisual product={product} />{product.virtualTryOn && <span className={styles.tryOnBadge}><Icon name="eye" size={15} /> Prueba virtual</span>}</Link><div className={styles.productBody}><p className={styles.productCategory}>{categoryNames[product.category] || "Producto"}</p>{product.isTestData && <p className={styles.testData}>Producto de prueba</p>}<h2><Link href={`/tienda/${product.id}`}>{product.name}</Link></h2><p className={styles.sku}>Código {product.sku}</p><div className={styles.productBottom}><strong>{formatPrice(product.unitPriceCents)}</strong><span className={product.availability?.available ? styles.available : styles.unavailable}>{product.availability?.available ? "Referencial" : "Consultar"}</span></div>{product.supportsPrescription && <p className={styles.prescription}><Icon name="file" size={15} /> Receta opcional</p>}<Link className={styles.productAction} href={`/tienda/${product.id}`}>Ver producto <Icon name="arrow" size={17} /></Link></div></article>)}</div>}
      {status === "ready" && result.totalPages > 1 && <nav aria-label="Paginación del catálogo" className={styles.pagination}><button disabled={page <= 1} onClick={() => changeFilters({ page: page - 1 })} type="button">Anterior</button><span aria-current="page">Página {page} de {result.totalPages}</span><button disabled={page >= result.totalPages} onClick={() => changeFilters({ page: page + 1 })} type="button">Siguiente</button></nav>}
    </section>
  </div>;
}
