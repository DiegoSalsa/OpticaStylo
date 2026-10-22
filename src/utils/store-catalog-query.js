export const STORE_CATEGORIES = ["FRAME", "TREATMENT", "ACCESSORY", "OTHER"];
export const STORE_SORTS = ["featured", "price-asc", "price-desc", "newest"];
export const STORE_PRESCRIPTIONS = ["all", "optional", "not-required"];

// La URL es la única fuente de filtros; normalizarla permite volver con atrás/adelante.
export function readStoreCatalogQuery(params) {
  const page = Number(params.get("page") ?? 1);
  return {
    category: STORE_CATEGORIES.includes(params.get("category")) ? params.get("category") : "",
    search: (params.get("search") ?? "").trim().slice(0, 100),
    prescription: STORE_PRESCRIPTIONS.includes(params.get("prescription")) ? params.get("prescription") : "all",
    availability: params.get("availability") === "available" ? "available" : "all",
    sort: STORE_SORTS.includes(params.get("sort")) ? params.get("sort") : "featured",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

// Omitir los valores por defecto conserva enlaces cortos y evita consultas equivalentes.
export function storeCatalogParams(query) {
  const params = new URLSearchParams();
  for (const key of ["category", "search", "prescription", "availability", "sort", "page"]) {
    const value = query[key];
    if (value && value !== "all" && value !== "featured" && !(key === "page" && value === 1)) {
      params.set(key, String(value));
    }
  }
  return params;
}
