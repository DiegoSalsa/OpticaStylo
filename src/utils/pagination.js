export const INTERNAL_PAGE_SIZE = 20;

export function paginationReducer(state, action) {
  switch (action.type) {
    case "filters": {
      const filters = { ...state.filters, ...action.filters };
      if (JSON.stringify(filters) === JSON.stringify(state.filters)) return state;
      return { ...state, filters, page: 1 };
    }
    case "page":
      return { ...state, page: Math.max(1, action.page) };
    case "reload":
      return { ...state, revision: state.revision + 1 };
    default:
      return state;
  }
}

export function resourceUrl(endpoint, filters, page, pageSize = INTERNAL_PAGE_SIZE) {
  const [path, query = ""] = endpoint.split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value == null) params.delete(key);
    else params.set(key, String(value));
  }
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `${path}?${params}`;
}

export function visibleRange({ page, pageSize, total, items }) {
  if (!total || !items.length) return { first: 0, last: 0 };
  const first = (page - 1) * pageSize + 1;
  return { first, last: Math.min(total, first + items.length - 1) };
}

export function pageNumbers(page, totalPages) {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  return Array.from({ length: Math.min(5, totalPages) }, (_, index) => start + index);
}

// Abort alone is insufficient when a response has already started being parsed.
export function createRequestGate() {
  let controller;
  return {
    begin() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      return { signal: current.signal, isCurrent: () => controller === current && !current.signal.aborted };
    },
    cancel() { controller?.abort(); controller = null; },
  };
}
