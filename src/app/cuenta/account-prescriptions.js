"use client";

import Link from "next/link";

const labels = { REPLACED: "Reemplazada", VOIDED: "Anulada" };
const date = (value) => new Date(value).toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
const value = (number) => number == null ? "—" : String(number);

function EyeValues({ label, eye }) {
  return <small>{label} · Esfera {value(eye.sphere)} · Cilindro {value(eye.cylinder)} · Eje {value(eye.axis)} · Adición {value(eye.addition)}</small>;
}

export default function AccountPrescriptions({ prescriptions, onUse, standalone }) {
  return <section id="recetas">
    {standalone ? <h2>Mis recetas</h2> : <h3>Mis recetas</h3>}
    {prescriptions.active.length === 0
      ? <><p className="clinical-empty">No tienes recetas vigentes disponibles.</p>
        <Link href="/cuenta?seccion=reservar">Reservar evaluación</Link></>
      : prescriptions.active.map((prescription) => (
        <details className="prescription-row" key={prescription.id ?? prescription.issuedAt}>
          <summary>Receta vigente · {date(prescription.issuedAt)}</summary>
          <div className="account-card-actions">
            <a className="button button--secondary" href={"/api/store/accounts/me/clinical/prescriptions/" + prescription.id + "/pdf"} download>Descargar PDF</a>
            <button className="button button--primary" type="button" onClick={() => onUse(prescription.id)}>Usar en mi carrito</button>
          </div>
          {prescription.professional && <p>Profesional: {prescription.professional.firstName} {prescription.professional.lastName}</p>}
          <EyeValues label="Ojo derecho" eye={prescription.rightEye} />
          <EyeValues label="Ojo izquierdo" eye={prescription.leftEye} />
          <small>Distancia pupilar {value(prescription.pupillaryDistance)}</small>
          {prescription.fulfillmentNotes && <small>Preparación: {prescription.fulfillmentNotes}</small>}
        </details>
      ))}
    {prescriptions.history.length > 0 && <>
      <h4>Versiones anteriores</h4>
      {prescriptions.history.map((prescription) => <article className="prescription-row" key={prescription.id ?? (prescription.issuedAt + prescription.status)}>
        <strong>{labels[prescription.status] ?? "Anulada"} · {date(prescription.issuedAt)}</strong>
        {prescription.professional && <span>Por {prescription.professional.firstName} {prescription.professional.lastName}</span>}
      </article>)}
    </>}
  </section>;
}
