"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { rememberClinicalPrescription } from "@/utils/store-cart-draft";
import { ensureStoreCart } from "@/utils/store-client";
import { AccountPagination, clinicalRecordsUrl, previewPage, useAccountPage } from "./account-pagination";

const labels = { REPLACED: "Reemplazada", VOIDED: "Anulada" };
const date = (value) => new Date(value).toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
const value = (number) => number == null ? "—" : String(number);

function EyeValues({ label, eye }) {
  return <small>{label} · Esfera {value(eye.sphere)} · Cilindro {value(eye.cylinder)} · Eje {value(eye.axis)} · Adición {value(eye.addition)}</small>;
}

export default function AccountPrescriptions({ accountId, prescriptions, standalone, title = "Recetas de la óptica", dependantId, onExpired }) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useAccountPage(clinicalRecordsUrl("active-prescriptions", dependantId), {
    initialPage: previewPage(prescriptions.active, prescriptions.activePage), onExpired,
  });
  const history = useAccountPage(clinicalRecordsUrl("prescription-history", dependantId), { onExpired });

  async function chooseRecipeForCart(prescriptionId) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const cart = await ensureStoreCart({ forShopping: true });
      rememberClinicalPrescription(accountId, cart.id, prescriptionId);
      router.push("/cuenta?seccion=carrito");
    } catch (failure) {
      setError(failure.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <section id="recetas">
    {standalone ? <h2>{title}</h2> : <h3>{title}</h3>}
    {active.status === "ready" && !active.total && <><p className="clinical-empty">No tienes recetas vigentes disponibles.</p>
      <Link href="/cuenta?seccion=reservar">Reservar evaluación</Link></>}
    {active.items.map((prescription) => (
        <details className="prescription-row" key={prescription.id ?? prescription.issuedAt}>
          <summary>Receta vigente · {date(prescription.issuedAt)}</summary>
          <div className="account-card-actions">
            <a className="button button--secondary" href={"/api/store/accounts/me/clinical/prescriptions/" + prescription.id + "/pdf"} download>Descargar PDF</a>
            <button className="button button--primary" type="button" disabled={busy} onClick={() => chooseRecipeForCart(prescription.id)}>{busy ? "Abriendo carrito…" : "Usar en mi carrito"}</button>
          </div>
          {prescription.professional && <p>Profesional: {prescription.professional.firstName} {prescription.professional.lastName}</p>}
          <EyeValues label="Ojo derecho" eye={prescription.rightEye} />
          <EyeValues label="Ojo izquierdo" eye={prescription.leftEye} />
          <small>Distancia pupilar {value(prescription.pupillaryDistance)}</small>
          {prescription.fulfillmentNotes && <small>Preparación: {prescription.fulfillmentNotes}</small>}
        </details>
      ))}
    <AccountPagination list={active} label="recetas vigentes" />
    {error && <p className="inline-error" role="alert">{error}</p>}
    <h4>Versiones anteriores</h4>
    {history.status === "ready" && !history.total && <p className="clinical-empty">No hay versiones anteriores registradas.</p>}
    {history.items.map((prescription) => <article className="prescription-row" key={prescription.id}>
      <strong>{labels[prescription.status] ?? "Anulada"} · {date(prescription.issuedAt)}</strong>
      {prescription.professional && <span>Por {prescription.professional.firstName} {prescription.professional.lastName}</span>}
    </article>)}
    <AccountPagination list={history} label="versiones anteriores" />
  </section>;
}
