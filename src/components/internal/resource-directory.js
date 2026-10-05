"use client";

import { useEffect, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import "./resource-directory.css";

export default function ResourceDirectory({ columns, description, endpoint, permission, title }) {
  const actor = useInternalActor();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const allowed = actor?.permissions.includes(permission);
  useEffect(() => {
    if (!actor || !allowed) return;
    const controller = new AbortController();
    const separator = endpoint.includes("?") ? "&" : "?";
    async function load() {
      try {
        const result = await readResponse(await fetch(`${endpoint}${separator}search=${encodeURIComponent(submitted)}&pageSize=50`, { signal: controller.signal }));
        setData(Array.isArray(result) ? { items: result, total: result.length } : result); setStatus("ready");
      } catch (requestError) {
        if (requestError.name !== "AbortError") { setError(requestError.message); setStatus("error"); }
      }
    }
    void load();
    return () => controller.abort();
  }, [actor, allowed, endpoint, submitted]);
  if (actor && !allowed) return <section className="app-card empty-module"><h2>Acceso no disponible</h2><p>Este módulo no corresponde a las funciones de tu rol.</p></section>;
  function submit(event) { event.preventDefault(); setError(""); setStatus("loading"); setSubmitted(query.trim()); }
  return <><header className="app-heading"><div><p className="eyebrow">Gestión</p><h1>{title}</h1><p>{description}</p></div>{status==="ready"&&<span className="status-chip">{data.total} registros</span>}</header><section className="app-card directory-card"><form className="directory-search" onSubmit={submit}><Icon name="search" /><input aria-label={`Buscar en ${title}`} onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar por nombre, RUT, correo o código" value={query} /><button className="app-button" type="submit">Buscar</button></form>{status==="loading"?<p className="directory-state">Cargando información…</p>:status==="error"?<p className="inline-error">{error}</p>:!data.items.length?<p className="directory-state">No hay registros para mostrar.</p>:<div className="directory-table" role="table"><div className="directory-row directory-head" role="row">{columns.map((column)=><span key={column.label} role="columnheader">{column.label}</span>)}</div>{data.items.map((item,index)=><div className="directory-row" key={item.id??index} role="row">{columns.map((column)=><span key={column.label} role="cell" data-label={column.label}>{column.render(item)}</span>)}</div>)}</div>}</section></>;
}
