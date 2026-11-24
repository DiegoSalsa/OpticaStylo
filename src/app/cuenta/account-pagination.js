"use client";

import { useEffect, useReducer, useState } from "react";
import { INTERNAL_PAGE_SIZE, paginationReducer, resourceUrl, visibleRange } from "@/utils/pagination";
import { readStoreResponse } from "@/utils/store-client";

export function clinicalRecordsUrl(type, dependantId) {
  const params = new URLSearchParams({ type });
  if (dependantId) params.set("dependantId", dependantId);
  return "/api/store/accounts/me/clinical/records?" + params;
}

export function previewPage(items, page) {
  return { items, page: 1, pageSize: INTERNAL_PAGE_SIZE, total: items.length, totalPages: items.length ? 1 : 0, ...page };
}

export function useAccountPage(endpoint, { enabled = true, initialPage, onExpired } = {}) {
  const [request, dispatch] = useReducer(paginationReducer, { filters: {}, page: 1, revision: 0 });
  const [result, setResult] = useState(null);
  const url = resourceUrl(endpoint, request.filters, request.page);
  const key = url + ":" + request.revision;
  const seeded = Boolean(enabled && initialPage && request.page === 1 && request.revision === 0 && !Object.keys(request.filters).length);

  useEffect(() => {
    if (!enabled || seeded) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(readStoreResponse)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.page !== request.page) {
          dispatch({ type: "page", page: data.page });
          return;
        }
        setResult({ key, data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error.status === 401) onExpired?.();
        setResult({ key, error: error.message });
      });
    return () => controller.abort();
  }, [enabled, onExpired, seeded, key, request.page, url]);

  const current = enabled && result?.key === key ? result : null;
  return {
    ...((seeded ? initialPage : current?.data) ?? { items: [], page: request.page, pageSize: INTERNAL_PAGE_SIZE, total: 0, totalPages: 0 }),
    status: seeded || current?.data ? "ready" : current?.error ? "error" : "loading",
    error: current?.error,
    filters: request.filters,
    setFilters: (filters) => dispatch({ type: "filters", filters }),
    setPage: (page) => dispatch({ type: "page", page }),
    reload: () => dispatch({ type: "reload" }),
  };
}

export function AccountPagination({ list, label }) {
  if (list.status === "loading") return <p role="status">Cargando {label}…</p>;
  if (list.status === "error") return (
    <p role="alert" className="inline-error">
      {list.error} <button type="button" onClick={list.reload}>Reintentar {label}</button>
    </p>
  );
  if (!list.total) return null;

  const { first, last } = visibleRange(list);
  return (
    <nav aria-label={"Paginación de " + label} className="commercial-actions">
      {list.totalPages > 1 && <button className="button button--secondary" type="button" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)}>Anterior</button>}
      <span role="status">Página {list.page} de {list.totalPages} · {first}–{last} de {list.total}</span>
      {list.totalPages > 1 && <button className="button button--secondary" type="button" disabled={list.page >= list.totalPages} onClick={() => list.setPage(list.page + 1)}>Siguiente</button>}
    </nav>
  );
}
