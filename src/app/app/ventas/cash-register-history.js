"use client";

import { useState } from "react";
import ScrollableTable from "@/components/internal/scrollable-table";
import Pagination from "@/components/internal/pagination";
import usePaginatedResource from "@/components/internal/use-paginated-resource";
import { MONEY_FORMATTER as money } from "./pos-form-model";

const format = (value) => value == null ? "—" : money.format(value);

export default function CashRegisterHistory({ branchId, canManage, onSelect, revision }) {
  const [expanded, setExpanded] = useState(false);
  const history = usePaginatedResource("/api/cash-register?history=true", {
    enabled: expanded,
    initialFilters: { branchId },
    reloadKey: revision,
  });

  function selectBranches(event) {
    const consolidated = event.target.checked;
    history.setFilters({ branchId: consolidated ? null : branchId, consolidated: consolidated || null });
  }

  return (
    <details className="cash-section" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>Historial de aperturas y cierres</summary>
      <div role="region" aria-label="Historial de sesiones de caja">
        {canManage && (
          <label>
            <input type="checkbox" checked={Boolean(history.filters.consolidated)} onChange={selectBranches} />
            Consultar todas las sucursales
          </label>
        )}
        {history.status === "ready" && history.items.length === 0 && <p>Sin sesiones para esta consulta.</p>}
        {history.items.length > 0 && (
          <div className="cash-ledger">
            <ScrollableTable label="Columnas de sesiones de caja">
              <table aria-label="Sesiones de caja">
                <thead><tr><th>Apertura / sucursal</th><th>Caja / responsable</th><th>Estado</th><th>Esperado / contado</th><th>Diferencia</th><th>Detalle</th></tr></thead>
                <tbody>{history.items.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.openedAt).toLocaleString("es-CL")}<small>{row.branch}</small></td>
                    <td>{row.terminal}<small>{row.responsible}</small></td>
                    <td>{row.status === "CLOSED" ? "Cerrada" : "Abierta"}</td>
                    <td>{format(row.expectedAmountCents)} / {format(row.countedCents)}</td>
                    <td>{format(row.differenceCents)}</td>
                    <td>{row.status === "CLOSED" && row.branchId && (
                      <button className="text-button" type="button" onClick={() => onSelect(row.id)}>Ver cierre</button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table>
            </ScrollableTable>
          </div>
        )}
        <Pagination {...history} label="sesiones de caja" />
      </div>
    </details>
  );
}
