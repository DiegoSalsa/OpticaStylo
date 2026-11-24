"use client";

import { useState } from "react";
import Pagination from "@/components/internal/pagination";
import usePaginatedResource from "@/components/internal/use-paginated-resource";

const transferStatuses = {
  DISPATCHED: "En tránsito",
  RECEIVED: "Recibida",
  CANCELLED: "Devuelta al origen",
};

export function InventoryTransfers({ branchId, busy, canWrite, onUpdate, revision }) {
  const list = usePaginatedResource("/api/inventory/transfers", {
    initialFilters: { branchId }, reloadKey: revision,
  });
  return (
    <section aria-labelledby="inventory-transfers" className="app-card">
      <h2 id="inventory-transfers">Transferencias</h2>
      <label className="field">
        <span>Estado del traspaso</span>
        <select onChange={(event) => list.setFilters({ status: event.target.value })} value={list.filters.status ?? ""}>
          <option value="">Todos los estados</option>
          {Object.entries(transferStatuses).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      {list.status === "ready" && list.items.length === 0 && <p>Sin transferencias para este filtro.</p>}
      {list.items.map((transfer) => {
        const incoming = transfer.destination_id === branchId;
        return (
          <article key={transfer.id}>
            <p>{transfer.products.name} · {transfer.quantity} unidades · {transfer.source.name} → {transfer.destination.name} · {transferStatuses[transfer.status]}</p>
            {canWrite && transfer.status === "DISPATCHED" && (
              <button className="app-button" disabled={busy} onClick={() => onUpdate(transfer.id, incoming ? "RECEIVE" : "CANCEL")} type="button">
                {incoming ? "Confirmar recepción física" : "Cancelar y devolver al origen"}
              </button>
            )}
          </article>
        );
      })}
      <Pagination {...list} label="transferencias" />
    </section>
  );
}

function HistoryRows({ branchId, productId, kinds }) {
  const list = usePaginatedResource("/api/inventory/movements", {
    initialFilters: { branchId, productId },
  });

  function setPage(page) {
    // Conservar el corte inicial al navegar por registros anteriores.
    if (list.asOf && !list.filters.asOf) list.setFilters({ asOf: list.asOf });
    list.setPage(page);
  }

  return (
    <>
      {list.status === "ready" && list.items.length === 0 && <p>Sin movimientos para este filtro.</p>}
      {list.items.length > 0 && (
        <div className="inventory-table">
          <table aria-label="Movimientos de inventario">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th>Antes → después</th><th>Reserva</th><th>Motivo y responsable</th></tr></thead>
            <tbody>
              {list.items.map((move) => (
                <tr key={move.id}>
                  <td>{new Date(move.createdAt).toLocaleString("es-CL")}</td>
                  <td>{move.productName}<small>{move.productSku}</small></td>
                  <td>{kinds[move.kind]}</td>
                  <td>{move.before ?? "sin conteo"} → {move.after}</td>
                  <td>{move.reservedBefore} → {move.reservedAfter}</td>
                  <td>{move.reason}<small>{move.actor}</small>{move.saleId && <small>Pedido {move.saleId}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...list} label="movimientos" setPage={setPage} />
    </>
  );
}

export function InventoryHistory({ branchId, kinds, revision }) {
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState(null);
  const products = usePaginatedResource("/api/inventory/movement-products", {
    initialFilters: { branchId }, reloadKey: revision,
  });

  function search(event) {
    event.preventDefault();
    products.setFilters({ search: query.trim() });
  }

  const selectedOption = products.items.some((item) => item.id === product?.id) ? product.id : "";

  return (
    <section aria-labelledby="inventory-history" className="app-card">
      <h2 id="inventory-history">Historial de movimientos</h2>
      <form onSubmit={search}>
        <label className="field">
          <span>Buscar producto en el historial</span>
          <input maxLength={100} onChange={(event) => setQuery(event.target.value)} value={query} />
        </label>
        <button className="app-button" type="submit">Buscar por nombre o SKU</button>
      </form>
      <label className="field">
        <span>Producto del historial</span>
        <select
          disabled={products.status !== "ready" || products.items.length === 0}
          onChange={(event) => setProduct(products.items.find((item) => item.id === event.target.value) ?? null)}
          value={selectedOption}
        >
          <option value="">Selecciona un resultado</option>
          {products.items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
        </select>
      </label>
      {products.status === "ready" && products.items.length === 0 && <p>Sin productos con movimientos para esta búsqueda.</p>}
      <Pagination {...products} label="productos del historial" />
      {product && (
        <div className="editor-actions">
          <p>Producto seleccionado: {product.sku} · {product.name}</p>
          <button className="app-button" onClick={() => setProduct(null)} type="button">Ver todos los movimientos</button>
        </div>
      )}
      <HistoryRows key={JSON.stringify([product?.id, revision])} branchId={branchId} productId={product?.id} kinds={kinds} />
    </section>
  );
}
