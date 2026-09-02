"use client";

import Icon from "@/components/ui/icon";
import { APPOINTMENT_LABELS } from "./clinical-form-model";
import ClinicalEncounterPanel from "./clinical-encounter-panel";
import ClinicalPrescriptionPanel from "./clinical-prescription-panel";
import MedicalRecordPanel from "./medical-record-panel";

const LABELS = APPOINTMENT_LABELS;

export default function ClinicalInterface({ model }) {
  const {
    appointments,
    busy,
    createEncounter,
    encounter,
    encounterForm,
    hasUnsavedChanges,
    markPresent,
    notice,
    openAppointment,
    selected,
    setEncounterForm,
    status,
  } = model;

  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Atención clínica</p>
          <h1>Gestión clínica</h1>
          <p>
            Solo se muestran pacientes asignados al profesional autenticado.
          </p>
        </div>
        <div className="clinical-heading-status">
          {hasUnsavedChanges && (
            <span className="status-chip status-chip--pending">
              Cambios sin guardar
            </span>
          )}
          <span className="status-chip">Historial permanente</span>
        </div>
      </header>
      {notice && (
        <p
          className={
            notice.kind === "error" ? "inline-error" : "inline-success"
          }
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <div className="clinical-layout">
        <aside className="app-card clinical-appointments">
          <h2>Atenciones asignadas</h2>
          {status === "loading" ? (
            <p className="directory-state">Cargando agenda…</p>
          ) : !appointments.length ? (
            <p className="directory-state">No hay atenciones en el periodo.</p>
          ) : (
            <div className="management-list">
              {appointments.map((appointment) => (
                <button
                  className={
                    selected?.id === appointment.id
                      ? "management-item active"
                      : "management-item"
                  }
                  key={appointment.id}
                  onClick={() => openAppointment(appointment)}
                  type="button"
                >
                  <span className="management-avatar">
                    <Icon name="calendar" size={17} />
                  </span>
                  <span>
                    <strong>
                      {appointment.patient.firstNames}{" "}
                      {appointment.patient.lastNames}
                    </strong>
                    <small>
                      {new Date(appointment.startAt).toLocaleString("es-CL")}
                    </small>
                    <small>{LABELS[appointment.status]}</small>
                  </span>
                  <i className="status-dot" />
                </button>
              ))}
            </div>
          )}
        </aside>
        <main className="clinical-workspace">
          {!selected ? (
            <section className="app-card empty-module">
              <h2>Selecciona una atención</h2>
              <p>
                Desde aquí se registran antecedentes, examen, diagnóstico,
                receta y adendas.
              </p>
            </section>
          ) : status === "loading-detail" ? (
            <section className="app-card empty-module">
              <p>Cargando información clínica autorizada…</p>
            </section>
          ) : (
            <>
              <section className="app-card clinical-section">
                <div className="editor-heading">
                  <div>
                    <p className="eyebrow">{selected.patient.rut}</p>
                    <h2>
                      {selected.patient.firstNames} {selected.patient.lastNames}
                    </h2>
                    <p className="clinical-appointment-context">
                      Reserva del{" "}
                      {new Date(selected.startAt).toLocaleString("es-CL", {
                        timeZone: "America/Santiago",
                      })}
                      {" · "}
                      {selected.professional.firstName}{" "}
                      {selected.professional.lastName}
                    </p>
                  </div>
                  <span className="status-chip">{LABELS[selected.status]}</span>
                </div>
                {selected.status === "CONFIRMED" && (
                  <div className="clinical-actions">
                    <button
                      className="app-button app-button--primary"
                      disabled={status === "saving"}
                      onClick={markPresent}
                      type="button"
                    >
                      Marcar presente e iniciar
                    </button>
                  </div>
                )}
                {selected.status === "CHECKED_IN" && !encounter && (
                  <form onSubmit={createEncounter}>
                    <label className="field">
                      <span>Motivo de consulta</span>
                      <textarea
                        maxLength="1000"
                        onChange={(event) =>
                          setEncounterForm({
                            ...encounterForm,
                            reasonForVisit: event.target.value,
                          })
                        }
                        required
                        value={encounterForm.reasonForVisit}
                      />
                    </label>
                    <div className="clinical-actions">
                      <button
                        className="app-button app-button--primary"
                        disabled={busy}
                        type="submit"
                      >
                        Crear borrador clínico
                      </button>
                    </div>
                  </form>
                )}
              </section>
              <MedicalRecordPanel model={model} />
              <ClinicalEncounterPanel model={model} />
              <ClinicalPrescriptionPanel model={model} />
            </>
          )}
        </main>
      </div>
    </>
  );
}
