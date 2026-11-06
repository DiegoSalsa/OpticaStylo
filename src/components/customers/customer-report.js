"use client";

import { useEffect, useState } from "react";
import { readResponse } from "@/components/internal/internal-shell";
export default function CustomerReport({
  from,
  to
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/reports/customers?from=${from}&to=${to}`, {
      cache: "no-store"
    }).then(readResponse).then(d => {
      if (active) setData(d);
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [from, to]);
  return <details className="app-card" style={{
    padding: "1.2rem",
    marginTop: "1rem"
  }}>
  <summary>Indicadores de clientes · {from} a {to}</summary>
  {error ? <p role="alert">{error}</p> : !data ? <p>Consultando indicadores comerciales…</p> : <><p>Período inclusivo en America/Santiago. Las compras corresponden a operaciones válidas según el libro de pagos.</p><dl className="commercial-metrics">
    {[["Clientes registrados globales", data.registeredCustomers], ["Registrados en el período", data.newCustomers], ["Compradores identificados", data.purchasingCustomers], ["Clientes con dos o más compras", data.recurringCustomers], ["Compras identificadas", data.identifiedPurchases], ["Compras anónimas", data.anonymousPurchases]].map(([name, v]) => <div key={name}>
      <dt>{name}</dt>
      <dd>{v}</dd>
    </div>)}
  </dl><p>{data.scope === "ALL_BRANCHES" ? "Compras de todas las sucursales." : "Compras limitadas a tus sucursales autorizadas. El registro de identidades es compartido entre sucursales."}</p></>}
</details>;
}
