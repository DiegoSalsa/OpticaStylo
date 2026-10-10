"use client";

import { pageNumbers, visibleRange } from "../../utils/pagination.js";
import "./pagination.css";

export default function Pagination({ label = "registros", items, page, pageSize, total, totalPages, status, error, setPage, reload }) {
  const { first, last } = visibleRange({ items, page, pageSize, total });
  const pages = pageNumbers(page, totalPages);
  const busy = status !== "ready";
  return <div className="pagination" aria-busy={status === "loading"}>
    <p aria-live="polite" role="status">{status === "loading" ? `Cargando ${label}…` : status === "error" ? "Listado no disponible" : `Mostrando ${first}–${last} de ${total}`}</p>
    {status === "error" && <div className="inline-error" role="alert">{error} <button className="app-button" onClick={reload} type="button">Reintentar</button></div>}
    <nav aria-label={`Paginación de ${label}`}>
      <button disabled={busy || page <= 1} onClick={() => setPage(page - 1)} type="button">Anterior</button>
      {pages[0] > 1 && <><button disabled={busy} onClick={() => setPage(1)} type="button" aria-label="Página 1">1</button><span>…</span></>}
      {pages.map((number) => <button aria-current={number === page ? "page" : undefined} aria-label={`Página ${number}`} disabled={busy} key={number} onClick={() => setPage(number)} type="button">{number}</button>)}
      {pages.at(-1) < totalPages && <><span>…</span><button disabled={busy} onClick={() => setPage(totalPages)} type="button" aria-label={`Página ${totalPages}`}>{totalPages}</button></>}
      <button disabled={busy || page >= totalPages} onClick={() => setPage(page + 1)} type="button">Siguiente</button>
    </nav>
    {status === "ready" && <small>Página {totalPages ? page : 0} de {totalPages}</small>}
  </div>;
}
