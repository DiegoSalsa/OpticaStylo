"use client";
import { useEffect, useRef, useState } from "react";
import { formatClp, readStoreResponse } from "@/utils/store-client";

export default function DeliveryChoice({ selection, onChange, signature }) {
  const revision = useRef(0);
  const [locations, setLocations] = useState({ regions: [], counties: [] });
  const [destination, setDestination] = useState({ regionCode: "", countyCode: "", street: "", number: "", supplement: "" });
  const [quotes, setQuotes] = useState([]);
  const visibleQuotes = quotes.filter((q) => q.cartSignature === signature);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (selection.method !== "DELIVERY") return;
    const controller = new AbortController();
    fetch(`/api/store/shipping/locations${destination.regionCode ? `?region=${encodeURIComponent(destination.regionCode)}` : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(readStoreResponse).then((data) => { if (!controller.signal.aborted) { setLocations(data); setError(""); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [selection.method, destination.regionCode]);
  function edit(key, value) {
    revision.current += 1;
    setStatus(""); setError("");
    setDestination((current) => ({ ...current, [key]: value, ...(key === "regionCode" ? { countyCode: "" } : {}) }));
    setQuotes([]); onChange({ method: "DELIVERY", quote: null });
  }
  function method(value) { revision.current += 1; setQuotes([]); setStatus(""); setError(""); onChange({ method: value, quote: null }); }
  async function quote() {
    const currentRevision = ++revision.current;
    setStatus("loading"); setError(""); setQuotes([]); onChange({ method: "DELIVERY", quote: null });
    try {
      const data = await readStoreResponse(await fetch("/api/store/cart/shipping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination }) }));
      if (currentRevision !== revision.current) return;
      setQuotes(data.quotes.map((q) => ({ ...q, cartSignature: signature }))); setStatus("valid");
      if (data.quotes.length === 1) onChange({ method: "DELIVERY", quote: data.quotes[0], signature });
    } catch (e) { if (currentRevision === revision.current) { setError(e.message); setStatus("error"); } }
  }
  return <fieldset className="shipping-choice field-full"><legend>Modalidad de entrega</legend>
    <label><input type="radio" name="deliveryMethod" checked={selection.method === "PICKUP"} onChange={() => method("PICKUP")} /> Retiro en sucursal</label>
    <label><input type="radio" name="deliveryMethod" checked={selection.method === "DELIVERY"} onChange={() => method("DELIVERY")} /> Despacho Chilexpress</label>
    {selection.method === "DELIVERY" && <div className="shipping-fields">
      {locations.synthetic && <p className="shipping-test" role="note">ENTORNO SINTÉTICO · Cotizaciones de prueba. No genera envíos reales.</p>}
      <p>Despacho gratuito en productos sobre {formatClp(locations.threshold ?? 100000)}, después de descuentos. Primero verifica tu destino y calcula una tarifa.</p>
      <label className="field"><span>Región de destino</span><select value={destination.regionCode} onChange={(e) => edit("regionCode", e.target.value)} required><option value="">Selecciona región</option>{locations.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label className="field"><span>Comuna de destino</span><select value={destination.countyCode} onChange={(e) => edit("countyCode", e.target.value)} required><option value="">Selecciona comuna</option>{locations.counties.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></label>
      <label className="field"><span>Calle de destino</span><input value={destination.street} onChange={(e) => edit("street", e.target.value)} maxLength={100} required /></label>
      <label className="field"><span>Número de destino</span><input value={destination.number} onChange={(e) => edit("number", e.target.value)} inputMode="numeric" maxLength={10} required /></label>
      <label className="field"><span>Departamento o complemento</span><input value={destination.supplement} onChange={(e) => edit("supplement", e.target.value)} maxLength={80} /></label>
      <button type="button" className="button button--secondary" disabled={status === "loading"} onClick={quote}>{status === "loading" ? "Consultando…" : "Verificar dirección y cotizar"}</button>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {status === "valid" && visibleQuotes.length > 0 && <p role="status">Dirección verificada. Selecciona el servicio de despacho.</p>}
      {visibleQuotes.map((q) => <label className="shipping-rate" key={q.id}><input type="radio" name="shippingService" checked={selection.quote?.id === q.id && selection.signature === signature} onChange={() => onChange({ method: "DELIVERY", quote: q, signature })} /> <strong>{q.service} · {q.customerCharge === 0 ? "Despacho gratis" : formatClp(q.customerCharge)}</strong><span>{q.conditions}</span><small>Origen: {q.branchName}. Cotización válida hasta {new Date(q.expiresAt).toLocaleTimeString("es-CL")}. {q.environment === "test" && "Ambiente oficial de pruebas, no productivo."}</small></label>)}
    </div>}
  </fieldset>;
}
