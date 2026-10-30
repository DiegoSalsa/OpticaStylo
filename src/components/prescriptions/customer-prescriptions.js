"use client";

import { useEffect, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";
import PrescriptionDetails from "./prescription-details";

export default function CustomerPrescriptions({ customerId }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/external-prescriptions?customerId=${customerId}`, { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse).then(setResult).catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError.message);
      });
    return () => controller.abort();
  }, [customerId, revision]);
  return <section className="app-card"><h3>Historial de recetas comerciales</h3>
    <p>Recetas externas y de compras del cliente. Las atenciones clínicas se consultan en su ficha.</p>
    {error ? <p role="alert">{error} <button onClick={() => { setError(""); setRevision((value) => value + 1); }} type="button">Reintentar</button></p>
      : !result ? <p role="status">Cargando recetas…</p> : !result.length ? <p>Sin recetas comerciales registradas.</p>
        : result.map((prescription) => <PrescriptionDetails endpoint={`/api/external-prescriptions/${prescription.id}`} key={prescription.id} label={`Ver receta del ${new Date(prescription.createdAt).toLocaleDateString("es-CL")}`} />)}
  </section>;
}
