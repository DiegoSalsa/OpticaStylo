"use client";

import { useRef, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";

function dateLabel(value) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(new Date(value));
}

export default function CartClinicalPrescription({ prescriptions, cart, preferredId, disabled, onSelected, onPending }) {
  const [selectedId, setSelectedId] = useState(preferredId ?? cart.clinicalPrescriptionId ?? "");
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const selected = prescriptions.some(({ id }) => id === selectedId) ? selectedId : "";

  async function save() {
    if (pending.current || !selected) return;
    pending.current = true;
    setError("");
    setSaving(true);
    onPending(true);
    try {
      const result = await readStoreResponse(await fetch("/api/store/cart/prescription/clinical", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prescriptionId: selected, replaceExisting: replace }),
      }));
      onSelected(result);
      setReplace(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      pending.current = false;
      setSaving(false);
      onPending(false);
    }
  }

  return <fieldset className="prescription-form" disabled={disabled || saving}>
    <legend>Usar una receta de mi cuenta</legend>
    <label className="field field-full">
      <span>Receta clínica vigente</span>
      <select value={selected} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">Elige una receta</option>
        {prescriptions.map(({ id, issuedAt, professional }) => <option key={id} value={id}>
          {dateLabel(issuedAt)}{professional && " · " + professional.firstName + " " + professional.lastName}
        </option>)}
      </select>
    </label>
    {cart.externalPrescription && <label className="field-full">
      <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
      Reemplazar la receta que ya adjunté al carrito
    </label>}
    <button className="button button--secondary field-full" type="button" onClick={save}
      disabled={!selected || selected === cart.clinicalPrescriptionId || Boolean(cart.externalPrescription && !replace)}>
      {saving ? "Guardando…" : "Usar esta receta"}
    </button>
    {error && <p className="inline-error field-full" role="alert">{error}</p>}
  </fieldset>;
}
