"use client";

import { CLINICAL_TYPES, clinicalAge } from "@/config/clinical-forms";
import OfficialFormFields, { TextField } from "./official-form-fields";
export default function ClinicalEncounterPanel({
  model: m
}) {
  const e = m.encounter;
  if (!e) return null;
  const editable = e.status === "DRAFT" && !e.isHistoricalVersion && e.professional.id === m.actor.userId;
  const p = e.patientSnapshot ?? e.patient;
  const printQuery = new URLSearchParams({
    patientId: e.patient.id,
    ...(e.isHistoricalVersion ? {
      revision: e.version
    } : {})
  });
  return <section className="app-card clinical-section">
  <div className="editor-heading">
    <div>
      <p className="eyebrow">Ficha N° {e.recordNumber ?? "histórica sin numeración"} · Versión {e.version}</p>
      <h2>{CLINICAL_TYPES[e.type]}</h2>
      <p>{e.status === "DRAFT" ? "Borrador" : "Finalizada · registro inmutable"}{e.isHistoricalVersion ? " · Versión histórica, solo lectura" : ""}</p>
    </div>
    <a target="_blank" rel="noreferrer" href={`/api/clinical-encounters/${e.id}/print?${printQuery}`}>Vista de impresión</a>
  </div>
  <p>{p.firstNames} {p.lastNames} · {p.rut} · Nacimiento: {p.birthDate ?? "Sin registro"} · Edad a la atención: {clinicalAge(p.birthDate, m.encounterForm.encounterDate) ?? "Sin registro"}</p>
  <p>{p.phone ?? "Sin teléfono"} · {p.email ?? "Sin correo"}</p>
  <p>Especialista: {e.professionalSnapshot?.firstName ?? e.professional.firstName} {e.professionalSnapshot?.lastName ?? e.professional.lastName} · {e.appointmentId ? "Con reserva asociada" : "Atención sin reserva"}</p>
  {!e.patientSnapshot && <p>Registro histórico sin copia de identificación original; se muestran datos actuales.</p>}
  <div className="clinical-actions">
    <label className="field"><span>Versiones guardadas</span><select value={e.isHistoricalVersion ? e.version : "current"} disabled={m.busy} onChange={v => m.openEncounter(e.id, v.target.value === "current" ? null : v.target.value)}><option value="current">Actual · {e.currentVersion ?? e.version}</option>{e.revisions.map(r => <option key={r.version} value={r.version}>Versión {r.version} · {new Date(r.recordedAt).toLocaleString("es-CL")}</option>)}</select></label>
    <button type="button" disabled={m.busy} onClick={() => m.openEncounter(e.id)}>Recargar ficha guardada</button>
  </div>
  <form onSubmit={m.saveEncounter}>
    <fieldset disabled={m.busy || !editable} className="clinical-editable">
      <TextField label="Fecha de atención" type="date" value={m.encounterForm.encounterDate} onChange={v => m.setEncounterForm({
          ...m.encounterForm,
          encounterDate: v
        })} />
      <details className="clinical-form-section" open>
        <summary>Motivo y anamnesis</summary>
        {[["reasonForVisit", "Motivo de consulta"], ["anamnesis", "Anamnesis"]].map(([key, label]) => <TextField key={key} label={label} multiline value={m.encounterForm[key]} onChange={v => m.setEncounterForm({
            ...m.encounterForm,
            [key]: v
          })} />)}
      </details>
      <OfficialFormFields type={e.type} data={m.encounterForm.formData} setData={formData => m.setEncounterForm({
          ...m.encounterForm,
          formData
        })} />
      <details className="clinical-form-section" open={e.type === "GENERAL"}>
        <summary>{e.type === "GENERAL" ? "Examen, diagnóstico e indicaciones" : "Información clínica complementaria"}</summary>
        {[["examination", "Examen"], ["diagnosis", "Diagnóstico"], ["indications", "Indicaciones"]].map(([key, label]) => <TextField key={key} label={label} multiline value={m.encounterForm[key]} onChange={v => m.setEncounterForm({
            ...m.encounterForm,
            [key]: v
          })} />)}
      </details>
    </fieldset>
    {editable && <div className="clinical-actions">
      <button className="app-button app-button--soft" disabled={m.busy || !m.encounterDirty}>Guardar borrador</button>
      <button type="button" className="app-button app-button--primary" disabled={m.busy || m.hasUnsavedChanges} onClick={m.finalize}>Finalizar atención</button>
    </div>}
  </form>
  <div className="addenda">
    <h3>Adendas permanentes</h3>
    {e.addenda.map(a => <article key={a.id}><strong>{a.reason}</strong><p>{a.content}</p><small>{new Date(a.createdAt).toLocaleString("es-CL")} · {a.authoredBy.firstName} {a.authoredBy.lastName}</small></article>)}
    {e.status === "FINALIZED" && !e.isHistoricalVersion && e.professional.id === m.actor.userId && <form onSubmit={m.addPermanentAddendum}>
      <TextField label="Motivo de la adenda" value={m.addendum.reason} maxLength={500} onChange={v => m.setAddendum({
          ...m.addendum,
          reason: v
        })} required />
      <TextField label="Contenido de la adenda" multiline maxLength={5000} value={m.addendum.content} onChange={v => m.setAddendum({
          ...m.addendum,
          content: v
        })} required />
      <button className="app-button app-button--soft" disabled={m.busy}>Agregar adenda</button>
    </form>}
  </div>
</section>;
}
