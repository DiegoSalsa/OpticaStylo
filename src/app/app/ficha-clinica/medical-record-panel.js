"use client";

import { FIELD_LABELS, RECORD_FIELDS } from "./clinical-form-model";

export default function MedicalRecordPanel({ model }) {
  const {
    busy,
    record,
    recordDirty,
    recordRevisions,
    saveRecord,
    selected,
    setRecord,
  } = model;

  return (
    <>
      <form className="app-card clinical-section" onSubmit={saveRecord}>
        <h2>Antecedentes permanentes</h2>
        <p>Los cambios quedan registrados como eventos de ficha.</p>
        <div className="clinical-textareas">
          {RECORD_FIELDS.map(([field, label]) => (
            <label
              className={`field ${field === "generalMedicalHistory" ? "field-wide" : ""}`}
              key={field}
            >
              <span>{label}</span>
              <textarea
                disabled={busy || selected.status === "CONFIRMED"}
                maxLength="5000"
                onChange={(event) =>
                  setRecord({ ...record, [field]: event.target.value })
                }
                value={record[field] ?? ""}
              />
            </label>
          ))}
        </div>
        {selected.status !== "CONFIRMED" && (
          <div className="clinical-actions">
            <button
              className="app-button app-button--soft"
              disabled={busy || !recordDirty}
              type="submit"
            >
              Guardar antecedentes
            </button>
          </div>
        )}
      </form>
      {recordRevisions.length > 0 && (
        <details className="app-card clinical-section revision-history">
          <summary>
            Historial de antecedentes · {recordRevisions.length}{" "}
            {recordRevisions.length === 1 ? "versión" : "versiones"}
          </summary>
          <p>
            Cada versión conserva exactamente el contenido que estaba vigente al
            momento de guardarla.
          </p>
          <div className="revision-list">
            {recordRevisions.map((revision) => (
              <details key={revision.id}>
                <summary>
                  <strong>Versión {revision.revision}</strong>
                  <small>
                    {new Date(revision.recordedAt).toLocaleString("es-CL")} ·{" "}
                    {revision.recordedBy.firstName}{" "}
                    {revision.recordedBy.lastName}
                  </small>
                </summary>
                <div className="revision-fields">
                  {RECORD_FIELDS.map(([field, label]) => (
                    <div key={field}>
                      <strong>{label}</strong>
                      <p>{revision[field] || "Sin registro"}</p>
                    </div>
                  ))}
                </div>
                <small>
                  Campos modificados:{" "}
                  {(revision.changedFields ?? [])
                    .map((field) => FIELD_LABELS[field] ?? field)
                    .join(", ") || "Creación de ficha"}
                </small>
              </details>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
