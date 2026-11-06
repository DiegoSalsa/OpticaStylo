"use client";

import { useEffect, useState } from "react";

import { readResponse } from "@/components/internal/internal-shell";

export default function useResourceSearch(endpoint, search, extraParams = "", enabled = true) {
  const [state, setState] = useState({ error: "", items: [], loading: true });

  useEffect(() => {
    if(!enabled)return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((value) => ({ ...value, error: "", loading: true }));
      const query = new URLSearchParams(extraParams);
      query.set("pageSize", "12");
      query.set("search", search);
      fetch(`${endpoint}?${query}`, { signal: controller.signal })
        .then(readResponse)
        .then((data) => { if (!controller.signal.aborted) setState({ error: "", items: data.items, loading: false }); })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setState({ error: error.message, items: [], loading: false });
          }
        });
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, extraParams, search, enabled]);

  return state;
}
