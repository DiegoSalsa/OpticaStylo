"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { announceStoreCartChange, ensureStoreCart, readStoreResponse } from "@/utils/store-client";
import { opticalData, prescriptionFields } from "@/utils/store-cart-draft";

const endpoint = "/api/store/accounts/me/prescriptions";
const parameters = [["Sphere", "Esfera", "0.25"], ["Cylinder", "Cilindro", "0.25"], ["Axis", "Eje", "1"], ["Addition", "Adición", "0.25"]];

export default function AccountSavedPrescriptions({ dependantId = null, title = "Mis recetas" }) {
  const router = useRouter();
  const [records, setRecords] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [replace, setReplace] = useState(false);
  const [replaceRequired, setReplaceRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint + (dependantId ? "?dependantId=" + encodeURIComponent(dependantId) : ""), { cache: "no-store", signal: controller.signal }).then(readStoreResponse)
      .then((data) => { if (!controller.signal.aborted) setRecords(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [attempt, dependantId]);

  function updateRecord(record) {
    setRecords((current) => [record, ...(current ?? []).filter(({ id }) => id !== record.id)]);
  }

  async function read(record) {
    const parsed = await readStoreResponse(await fetch(endpoint + "/" + record.id + "/read", { method: "POST" }));
    updateRecord(parsed);
    setEditing(parsed);
  }

  async function upload(event) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const uploaded = await readStoreResponse(await fetch(endpoint, { method: "POST", body: new FormData(form) }));
      updateRecord(uploaded);
      form.reset();
      await read(uploaded);
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }

  async function open(record) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await read(record); }
    catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }

  async function confirm(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const record = await readStoreResponse(await fetch(endpoint + "/" + editing.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...opticalData(new FormData(event.currentTarget)), imageHash: editing.imageHash }),
      }));
      updateRecord(record);
      setEditing(null);
    } catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }

  async function addToCart(record) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await ensureStoreCart({ forShopping: true });
      const cart = await readStoreResponse(await fetch("/api/store/cart/prescription/saved", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prescriptionId: record.id, replaceExisting: replace }),
      }));
      announceStoreCartChange(cart);
      router.push("/cuenta?seccion=carrito");
    } catch (failure) {
      setReplaceRequired(failure.code === "CONFIRM_PRESCRIPTION_REPLACEMENT");
      setError(failure.message);
    } finally { pending.current = false; setBusy(false); }
  }

  const values = prescriptionFields(editing?.extractedData);
  return <section className="account-card saved-prescriptions">
    <h1>{title}</h1>
    <p>Guarda una receta externa. OpenAI leerá sus valores para que puedas revisarlos antes de usarlos en una compra.</p>
    <form onSubmit={upload} className="clinical-link-form">
      {dependantId && <input type="hidden" name="dependantId" value={dependantId} />}
      <label className="field"><span>Archivo de la receta</span><input accept="image/jpeg,image/png,image/webp" disabled={busy} name="image" required type="file" /></label>
      <button className="button button--primary" disabled={busy} type="submit">{busy ? "Procesando receta…" : "Subir y leer receta"}</button>
      <small>JPEG, PNG o WEBP de hasta 4 MiB.</small>
    </form>
    {error && <p className="inline-error" role="alert">{error} {!records && <button onClick={() => { setError(""); setAttempt((n) => n + 1); }} type="button">Reintentar</button>}</p>}
    {!records && !error && <p role="status">Cargando tus recetas guardadas…</p>}
    {records?.length === 0 && <p>Todavía no tienes recetas externas guardadas.</p>}
    {editing && <form className="prescription-review" key={editing.id} onSubmit={confirm}>
      <h2>Revisa los valores de tu receta</h2>
      <p>Compara cada valor con el documento original antes de confirmar.</p>
      <a href={endpoint + "/" + editing.id} target="_blank" rel="noreferrer">Descargar original</a>
      {editing.extractedData?.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}
      <div className="prescription-eyes">{[["right", "Ojo derecho"], ["left", "Ojo izquierdo"]].map(([eye, title]) => <fieldset key={eye} disabled={busy}>
        <legend>{title}</legend>{parameters.map(([name, label, step]) => <label className="field" key={name}><span>{label}</span><input defaultValue={values[eye + name]} name={eye + name} type="number" step={step} required={name === "Sphere" || name === "Cylinder"} /></label>)}
      </fieldset>)}</div>
      <label className="field"><span>Distancia pupilar</span><input defaultValue={values.pupillaryDistance} name="pupillaryDistance" step="0.1" type="number" /></label>
      <label className="field"><span>Notas de la receta</span><textarea defaultValue={values.fulfillmentNotes} name="fulfillmentNotes" maxLength={1000} /></label>
      <button className="button button--primary" disabled={busy} type="submit">Confirmar y guardar receta</button>
    </form>}
    {replaceRequired && <label><input checked={replace} onChange={(event) => setReplace(event.target.checked)} type="checkbox" /> Reemplazar la receta actual del carrito</label>}
    {records?.map((record) => <article className="prescription-row" key={record.id}>
      <strong>{record.filename}</strong><small>{new Date(record.createdAt).toLocaleDateString("es-CL")} · {record.status === "READY" ? "Revisada y guardada" : "Pendiente de revisión"}</small>
      <div className="account-card-actions"><a className="button button--secondary" href={endpoint + "/" + record.id}>Descargar original</a>
        {record.status === "READY" ? <button className="button button--primary" disabled={busy || (replaceRequired && !replace)} onClick={() => addToCart(record)} type="button">Usar en mi carrito</button>
          : <button className="button button--secondary" disabled={busy} onClick={() => open(record)} type="button">Leer y revisar receta</button>}
      </div>
    </article>)}
  </section>;
}
