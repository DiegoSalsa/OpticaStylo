"use client";

export default function ClinicalEncounterPanel({ model }) {
  const {
    addPermanentAddendum,
    addendum,
    busy,
    encounter,
    encounterDirty,
    encounterForm,
    finalize,
    hasUnsavedChanges,
    saveEncounter,
    setAddendum,
    setEncounterForm,
  } = model;

  return (
    <>
      {encounter && (
        <form className="app-card clinical-section" onSubmit={saveEncounter}>
          <div className="editor-heading">
            <div>
              <p className="eyebrow">
                Atención{" "}
                {encounter.status === "DRAFT" ? "en borrador" : "finalizada"}
              </p>
              <h2>Examen y diagnóstico</h2>
            </div>
          </div>
          <div className="clinical-textareas">
            {[
              ["reasonForVisit", "Motivo de consulta"],
              ["anamnesis", "Anamnesis"],
              ["examination", "Examen"],
              ["diagnosis", "Diagnóstico"],
              ["indications", "Indicaciones"],
            ].map(([field, label]) => (
              <label
                className={`field ${field === "examination" ? "field-wide" : ""}`}
                key={field}
              >
                <span>{label}</span>
                <textarea
                  disabled={busy || encounter.status !== "DRAFT"}
                  maxLength={
                    field === "reasonForVisit"
                      ? 1000
                      : field === "anamnesis" || field === "examination"
                        ? 10000
                        : 5000
                  }
                  onChange={(event) =>
                    setEncounterForm({
                      ...encounterForm,
                      [field]: event.target.value,
                    })
                  }
                  required={field === "reasonForVisit"}
                  value={encounterForm[field]}
                />
              </label>
            ))}
          </div>
          {encounter.status === "DRAFT" && (
            <div className="clinical-actions">
              <button
                className="app-button app-button--soft"
                disabled={busy || !encounterDirty}
                type="submit"
              >
                Guardar borrador
              </button>
              <button
                className="app-button app-button--primary"
                disabled={
                  busy ||
                  hasUnsavedChanges ||
                  !encounterForm.examination.trim() ||
                  !encounterForm.diagnosis.trim()
                }
                onClick={finalize}
                type="button"
              >
                Finalizar atención
              </button>
            </div>
          )}
          {encounter.status === "FINALIZED" && (
            <div className="addenda">
              <h2>Adendas permanentes</h2>
              {(encounter.addenda ?? []).map((item) => (
                <article key={item.id}>
                  <strong>{item.reason}</strong>
                  <p>{item.content}</p>
                  <small>
                    {new Date(item.createdAt).toLocaleString("es-CL")} ·{" "}
                    {item.authoredBy.firstName} {item.authoredBy.lastName}
                  </small>
                </article>
              ))}
              <div>
                <div className="management-fields">
                  <label className="field">
                    <span>Motivo de la adenda</span>
                    <input
                      disabled={busy}
                      maxLength="500"
                      onChange={(event) =>
                        setAddendum({
                          ...addendum,
                          reason: event.target.value,
                        })
                      }
                      required
                      value={addendum.reason}
                    />
                  </label>
                  <label className="field field-wide">
                    <span>Contenido</span>
                    <textarea
                      disabled={busy}
                      maxLength="5000"
                      onChange={(event) =>
                        setAddendum({
                          ...addendum,
                          content: event.target.value,
                        })
                      }
                      required
                      value={addendum.content}
                    />
                  </label>
                </div>
                <div className="clinical-actions">
                  <button
                    className="app-button app-button--soft"
                    disabled={
                      busy ||
                      !addendum.reason.trim() ||
                      !addendum.content.trim()
                    }
                    onClick={addPermanentAddendum}
                    type="button"
                  >
                    Agregar adenda
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      )}
    </>
  );
}
