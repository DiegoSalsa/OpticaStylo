"use client";
import { useEffect, useState } from "react";
import { formatClp, readStoreResponse } from "@/utils/store-client";
import { useInternalActor } from "@/components/internal/internal-shell";

const labels = { PENDING_PREPARATION: "Pendiente de preparación", PREPARED: "Preparado", ISSUING: "Emisión de OT en curso", UNCERTAIN: "Emisión incierta: requiere conciliación", OT_ISSUED: "OT emitida", HANDED_OVER: "Entregado al transportista", IN_TRANSIT: "En tránsito", DELIVERED: "Entregado", EXCEPTION: "Incidencia o estado pendiente de revisión", CANCELLED: "Cancelado antes de emisión" };
export default function ShipmentPanel({ saleId, internal = false }) {
  const actor = useInternalActor();
  const [shipment, setShipment] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [evidence, setEvidence] = useState("");
  const [loaded, setLoaded] = useState(false);
  const endpoint = internal ? `/api/sales/${saleId}/shipment` : `/api/store/orders/${saleId}/shipment`;
  const canWrite = internal && actor?.permissions.includes("sales.update");
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(readStoreResponse)
      .then((data) => { if (!controller.signal.aborted) setShipment(data); }).catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, [endpoint]);
  async function action(action) {
    setBusy(true); setError("");
    try { setShipment(await readStoreResponse(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, evidence }) }))); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="shipment-panel" aria-label="Seguimiento del despacho"><h3>Despacho Chilexpress</h3>
    {shipment?.synthetic && <p className="shipping-test">PRUEBA SINTÉTICA · OT, etiqueta y eventos sin validez productiva.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!shipment ? <p>{loaded ? "No hay seguimiento disponible. Los pedidos históricos sin despacho registrado requieren revisión antes de operar." : "Consultando despacho…"}</p> : <>
      <dl><div><dt>Estado logístico</dt><dd>{labels[shipment.state] ?? shipment.state}</dd></div><div><dt>OT</dt><dd>{shipment.ot ?? "Pendiente de emisión"}</dd></div><div><dt>Servicio cotizado</dt><dd>{shipment.service}</dd></div>{shipment.issuedService && <div><dt>Servicio emitido</dt><dd>{shipment.issuedService}</dd></div>}
        <div><dt>Última consulta válida</dt><dd>{shipment.lastCheckedAt ? new Date(shipment.lastCheckedAt).toLocaleString("es-CL") : "Sin consulta de seguimiento"}</dd></div>
        {shipment.providerStatus && <div><dt>Estado informado por proveedor</dt><dd>{shipment.providerStatus}</dd></div>}
        {internal && <><div><dt>Origen de despacho</dt><dd>{shipment.origin.branchName}</dd></div><div><dt>Costo del proveedor</dt><dd>{formatClp(shipment.providerCost)}</dd></div><div><dt>Cobrado al comprador</dt><dd>{formatClp(shipment.customerCharge)}</dd></div><div><dt>Bulto</dt><dd>{shipment.parcel.weight} kg · {shipment.parcel.length} × {shipment.parcel.width} × {shipment.parcel.height} cm</dd></div></>}
      </dl>
      {shipment.lastErrorCode && <p role="alert">El proveedor no pudo actualizar el seguimiento. Se conserva la última información válida.</p>}
      {internal && <div className="shipment-actions">
        {canWrite && ["PENDING_PREPARATION", "OT_ISSUED"].includes(shipment.state) && <label className="field"><span>Referencia de preparación o comprobante de recepción</span><input value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={300} /></label>}
        {canWrite && shipment.state === "PENDING_PREPARATION" && <button className="app-button" type="button" disabled={busy || !evidence.trim()} onClick={() => action("PREPARE")}>Confirmar preparación</button>}
        {canWrite && ["PREPARED", "ISSUING", "UNCERTAIN"].includes(shipment.state) && <button className="app-button" type="button" disabled={busy} onClick={() => action("ISSUE")}>{shipment.state === "PREPARED" ? "Generar OT" : "Conciliar emisión incierta"}</button>}
        {shipment.ot && <a className="app-button" href={`${endpoint}/label`} target="_blank" rel="noreferrer">Obtener / imprimir etiqueta{shipment.synthetic ? " de prueba" : ""}</a>}
        {canWrite && shipment.state === "OT_ISSUED" && <button className="app-button" type="button" disabled={busy || !evidence.trim()} onClick={() => action("HAND_OVER")}>Registrar entrega al transportista</button>}
        {canWrite && shipment.ot && <button className="app-button" type="button" disabled={busy} onClick={() => action("SYNC")}>Actualizar seguimiento</button>}
      </div>}
      <ol>{shipment.events.map((e) => <li key={e.id}><time>{e.occurredAt ? new Date(e.occurredAt).toLocaleString("es-CL") : "Fecha no informada"}</time> · {e.description}{e.motive && ` · ${e.motive}`}{e.location && ` · ${e.location}`}</li>)}</ol>
      {internal && <details><summary>Historial de operaciones logísticas</summary><ol>{shipment.operations.map((o, i) => <li key={i}>{new Date(o.createdAt).toLocaleString("es-CL")} · {o.operation}{o.details.evidence && ` · ${o.details.evidence}`}</li>)}</ol><p>Cancelaciones con OT, devoluciones y reposición física requieren revisión. La plataforma no cancela transportes ni realiza reembolsos automáticamente.</p></details>}
    </>}
  </section>;
}
