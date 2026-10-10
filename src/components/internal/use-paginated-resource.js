"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { readResponse } from "./internal-shell";
import { INTERNAL_PAGE_SIZE, paginationReducer, resourceUrl } from "../../utils/pagination.js";

export default function usePaginatedResource(endpoint, { enabled = true, initialFilters = {}, reloadKey = 0 } = {}) {
  const [request, dispatch] = useReducer(paginationReducer, { filters: initialFilters, page: 1, revision: 0 });
  const [result, setResult] = useState(null);
  const url = resourceUrl(endpoint, request.filters, request.page);
  const key = `${url}:${request.revision}:${reloadKey}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // Defer to avoid issuing requests from discarded Strict Mode effects.
    const timer = setTimeout(async () => {
      try {
        const data = await readResponse(await fetch(url, { cache: "no-store", signal: controller.signal }));
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, data.totalPages);
        if (request.page > lastPage) {
          dispatch({ type: "page", page: lastPage });
          return;
        }
        setResult({ data, error: "", key });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ data: null, error: error.message, key });
      }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, key, request.page, url]);

  const setFilters = useCallback((filters) => dispatch({ type: "filters", filters }), []);
  const setPage = useCallback((page) => dispatch({ type: "page", page }), []);
  const reload = useCallback(() => dispatch({ type: "reload" }), []);
  const current = enabled && result?.key === key;
  const status = !current ? "loading" : result.error ? "error" : "ready";
  return {
    ...(current && result.data ? result.data : { items: [], page: request.page, pageSize: INTERNAL_PAGE_SIZE, total: 0, totalPages: 0 }),
    error: current ? result.error : "", filters: request.filters, reload, setFilters, setPage, status,
  };
}
