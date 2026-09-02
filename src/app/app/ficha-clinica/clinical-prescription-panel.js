"use client";

import PrescriptionVersion from "./prescription-version";

export default function ClinicalPrescriptionPanel({ model }) {
  const {
    activePrescription,
    busy,
    encounter,
    encounterPrescriptions,
    eye,
    history,
    prescription,
    prescriptions,
    savePrescription,
    setPrescription,
  } = model;

  return (
    <>
      {encounter && (
        <form className="app-card clinical-section" onSubmit={savePrescription}>
          <h2>Receta óptica</h2>
          <p>
            {activePrescription
              ? `Versión activa ${activePrescription.version}.`
              : "La receta es opcional y se emite solo si corresponde."}
          </p>
          <div className="prescription-grid-scroll">
            <div className="prescription-grid">
              <span />
              {["Esfera", "Cilindro", "Eje", "Adición"].map((label) => (
                <span className="field" key={label}>
                  <span>{label}</span>
                </span>
              ))}
              {[
                ["rightEye", "OD"],
                ["leftEye", "OI"],
              ].map(([side, label]) => (
                <div key={side} style={{ display: "contents" }}>
                  <strong>{label}</strong>
                  {[
                    ["sphere", false],
                    ["cylinder", false],
                    ["axis", true],
                    ["addition", true],
                  ].map(([field, nullable]) => (
                    <label className="field" key={field}>
                      <input
                        aria-label={`${label} ${field}`}
                        disabled={
                          busy ||
                          (encounter.status !== "DRAFT" && !activePrescription)
                        }
                        max={field === "axis" ? 180 : undefined}
                        min={field === "axis" ? 0 : undefined}
                        onChange={(event) =>
                          eye(side, field, event.target.value)
                        }
                        required={!nullable}
                        step={field === "axis" ? 1 : 0.25}
                        type="number"
                        value={prescription[side][field]}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="management-fields">
            <label className="field">
              <span>Distancia pupilar</span>
              <input
                disabled={
                  busy || (encounter.status !== "DRAFT" && !activePrescription)
                }
                min="0.01"
                onChange={(event) =>
                  setPrescription({
                    ...prescription,
                    pupillaryDistance: event.target.value,
                  })
                }
                step="0.01"
                type="number"
                value={prescription.pupillaryDistance}
              />
            </label>
            <label className="field">
              <span>Notas de fabricación</span>
              <input
                disabled={
                  busy || (encounter.status !== "DRAFT" && !activePrescription)
                }
                maxLength="1000"
                onChange={(event) =>
                  setPrescription({
                    ...prescription,
                    fulfillmentNotes: event.target.value,
                  })
                }
                value={prescription.fulfillmentNotes}
              />
            </label>
            {encounter.status === "FINALIZED" && activePrescription && (
              <label className="field field-wide">
                <span>Motivo obligatorio del reemplazo</span>
                <input
                  disabled={busy}
                  maxLength="500"
                  onChange={(event) =>
                    setPrescription({
                      ...prescription,
                      replacementReason: event.target.value,
                    })
                  }
                  required
                  value={prescription.replacementReason}
                />
              </label>
            )}
          </div>
          {(encounter.status === "DRAFT" || activePrescription) && (
            <div className="clinical-actions">
              <button
                className="app-button app-button--soft"
                disabled={busy}
                type="submit"
              >
                {activePrescription
                  ? encounter.status === "DRAFT"
                    ? "Actualizar receta"
                    : "Emitir reemplazo"
                  : "Emitir receta"}
              </button>
            </div>
          )}
          {encounterPrescriptions.length > 0 && (
            <details className="prescription-history">
              <summary>
                Historial de recetas · {encounterPrescriptions.length}{" "}
                {encounterPrescriptions.length === 1 ? "versión" : "versiones"}
              </summary>
              <div className="prescription-version-list">
                {encounterPrescriptions.map((item) => (
                  <PrescriptionVersion item={item} key={item.id} />
                ))}
              </div>
            </details>
          )}
        </form>
      )}
      {history.length > 0 && (
        <section className="app-card clinical-section">
          <h2>Historial finalizado</h2>
          <div className="history-list">
            {history.map((item) => {
              const versions = prescriptions
                .filter(
                  (prescriptionItem) =>
                    prescriptionItem.encounterId === item.id,
                )
                .sort((left, right) => right.version - left.version);
              return (
                <details className="history-entry" key={item.id}>
                  <summary>
                    <strong>
                      {new Date(item.finalizedAt).toLocaleDateString("es-CL")} ·{" "}
                      {item.diagnosis}
                    </strong>
                    <small>
                      {item.professional.firstName} {item.professional.lastName}{" "}
                      · {item.reasonForVisit}
                    </small>
                  </summary>
                  <div className="history-detail">
                    {[
                      ["Anamnesis", item.anamnesis],
                      ["Examen", item.examination],
                      ["Diagnóstico", item.diagnosis],
                      ["Indicaciones", item.indications],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <strong>{label}</strong>
                        <p>{value || "Sin registro"}</p>
                      </div>
                    ))}
                    {(item.addenda ?? []).length > 0 && (
                      <div className="history-addenda">
                        <strong>Adendas</strong>
                        {item.addenda.map((historyAddendum) => (
                          <article key={historyAddendum.id}>
                            <b>{historyAddendum.reason}</b>
                            <p>{historyAddendum.content}</p>
                            <small>
                              {new Date(
                                historyAddendum.createdAt,
                              ).toLocaleString("es-CL")}{" "}
                              · {historyAddendum.authoredBy.firstName}{" "}
                              {historyAddendum.authoredBy.lastName}
                            </small>
                          </article>
                        ))}
                      </div>
                    )}
                    {versions.length > 0 && (
                      <div className="prescription-version-list field-wide">
                        {versions.map((version) => (
                          <PrescriptionVersion
                            item={version}
                            key={version.id}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
