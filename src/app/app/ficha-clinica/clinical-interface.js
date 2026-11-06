"use client";

import { CLINICAL_TYPES } from "@/config/clinical-forms";
import ClinicalEncounterPanel from "./clinical-encounter-panel";
import ClinicalPrescriptionPanel from "./clinical-prescription-panel";
import MedicalRecordPanel from "./medical-record-panel";
const labels = {
  CONFIRMED: "Confirmada",
  CHECKED_IN: "Presente",
  COMPLETED: "Completada"
};
export default function ClinicalInterface({
  model: m
}) {
  const appointment = m.appointments.find(a => a.id === m.appointmentId);
  return <><header className="app-heading">
  <div>
    <p className="eyebrow">Atención clínica</p>
    <h1>Gestión clínica</h1>
    <p>Pacientes asignados al profesional autenticado.</p>
  </div>
  <span className="status-chip">{m.hasUnsavedChanges ? "Cambios sin guardar" : "Cambios guardados"}</span>
</header>
 {m.notice && <p role={m.notice.kind === "error" ? "alert" : "status"} className={m.notice.kind === "error" ? "inline-error" : "inline-success"}>{m.notice.text}</p>}
 <div className="clinical-layout">
  <aside className="app-card clinical-appointments">
    <h2>Pacientes asignados</h2>
    <form onSubmit={e => {
          e.preventDefault();
          m.searchPatients();
        }}>
      <label className="field"><span>Buscar nombre o RUT asignado</span><input value={m.search} onChange={e => m.setSearch(e.target.value)} /></label>
      <button className="app-button app-button--soft">Buscar pacientes</button>
    </form>
    <div className="management-list">
      {m.directory.items.map(p => <button className={`management-item ${m.selected?.patient.id === p.id ? "active" : ""}`} disabled={m.busy} key={p.id} type="button" onClick={() => m.openPatient(p)}><span><strong>{p.firstNames} {p.lastNames}</strong><small>{p.rut}</small></span></button>)}
    </div>
    {!m.directory.items.length && <p>No hay pacientes en esta búsqueda autorizada.</p>}
    <div className="clinical-actions">
      <button disabled={m.directory.page <= 1} onClick={() => m.searchPatients(m.directory.page - 1)}>Anterior</button>
      <span>{m.directory.page} / {m.directory.totalPages || 1}</span>
      <button disabled={m.directory.page >= m.directory.totalPages} onClick={() => m.searchPatients(m.directory.page + 1)}>Siguiente</button>
    </div>
  </aside>
  <main className="clinical-workspace">
    {!m.selected ? <section className="app-card empty-module">
      <h2>Seleccione un paciente</h2>
      <p>Recepción puede asignar una atención presencial desde Pacientes, verificando su identidad.</p>
    </section> : <>
 <section className="app-card clinical-section">
      <p className="eyebrow">{m.selected.patient.rut}</p>
      <h2>{m.selected.patient.firstNames} {m.selected.patient.lastNames}</h2>
      <p>Verifique nombre y RUT antes de iniciar una atención.</p>
      <details open={!m.encounter}>
        <summary>Nueva atención</summary>
        <form onSubmit={m.createEncounter}>
          <div className="management-fields">
            <label className="field"><span>Origen</span><select value={m.appointmentId} disabled={m.busy} onChange={e => m.setAppointmentId(e.target.value)}><option value="">Sin reserva · atención presencial</option>{m.appointments.map(a => <option key={a.id} value={a.id}>{new Date(a.startAt).toLocaleString("es-CL")} · {labels[a.status]}</option>)}</select></label>
            <label className="field"><span>Tipo de ficha</span><select value={m.type} onChange={e => m.setType(e.target.value)}>{Object.entries(CLINICAL_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="field"><span>Fecha de nueva atención</span><input type="date" required value={m.newDate} onChange={e => m.setNewDate(e.target.value)} /></label>
            <label className="field"><span>Motivo inicial</span><input value={m.newReason} onChange={e => m.setNewReason(e.target.value)} maxLength={1000} /></label>
          </div>
          {appointment?.status === "CONFIRMED" ? <button type="button" className="app-button app-button--soft" disabled={m.busy} onClick={m.markPresent}>Marcar presente</button> : <button className="app-button app-button--primary" disabled={m.busy || !!appointment && (appointment.status !== "CHECKED_IN" || !!appointment.encounterId)}>Crear borrador clínico</button>}
        </form>
      </details>
    </section>
 <section className="app-card clinical-section">
      <h2>Historial del paciente</h2>
      <details open={!m.encounter}>
      <summary>Ver atenciones · {m.history.total ?? 0} registros</summary>
      <div className="history-list">
        {m.history.encounters.map(e => <button key={e.id} type="button" className="management-item" disabled={m.busy} onClick={() => m.openEncounter(e.id)}><span><strong>{e.encounterDate ?? "Fecha clínica no consignada"} · {CLINICAL_TYPES[e.type]}</strong><small>{e.professional.firstName} {e.professional.lastName} · {e.status === "DRAFT" ? "Borrador" : "Finalizada"} · Ficha {e.recordNumber ?? "histórica"}</small></span></button>)}
      </div>
      {!m.history.encounters.length && <p>Sin atenciones registradas.</p>}
      <div className="clinical-actions">
        <button disabled={m.history.page <= 1 || m.busy} onClick={() => m.historyPage(m.history.page - 1)}>Historial anterior</button>
        <span>Página {m.history.page} / {m.history.totalPages || 1}</span>
        <button disabled={m.history.page >= m.history.totalPages || m.busy} onClick={() => m.historyPage(m.history.page + 1)}>Historial siguiente</button>
      </div>
      </details>
    </section>
 <ClinicalEncounterPanel model={m} /><details className="app-card clinical-section">
      <summary>Antecedentes permanentes del paciente</summary>
      <MedicalRecordPanel model={m} />
    </details>{m.encounter && !m.encounter.isHistoricalVersion && m.encounter.professional.id === m.actor?.userId && <details className="app-card clinical-section">
      <summary>Prescripción óptica · emisión profesional explícita</summary>
      <ClinicalPrescriptionPanel model={{
              ...m,
              history: []
            }} />
    </details>}
 </>}
  </main>
</div></>;
}
