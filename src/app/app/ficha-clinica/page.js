"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import "../management.css";
import "./clinical.css";

const RECORD_FIELDS = [
  ["generalMedicalHistory", "Antecedentes médicos generales"],
  ["ocularHistory", "Antecedentes oculares"],
  ["familyOcularHistory", "Antecedentes oculares familiares"],
  ["allergies", "Alergias"],
  ["currentMedications", "Medicamentos actuales"],
];
const EMPTY_RECORD = Object.fromEntries(
  RECORD_FIELDS.map(([field]) => [field, ""]),
);
const EMPTY_ENCOUNTER = {
  anamnesis: "",
  diagnosis: "",
  examination: "",
  indications: "",
  reasonForVisit: "",
};
const EMPTY_EYE = { addition: "", axis: "", cylinder: "0", sphere: "0" };
const EMPTY_PRESCRIPTION = {
  fulfillmentNotes: "",
  leftEye: { ...EMPTY_EYE },
  pupillaryDistance: "",
  replacementReason: "",
  rightEye: { ...EMPTY_EYE },
};
const LABELS = {
  CHECKED_IN: "Presente",
  COMPLETED: "Completada",
  CONFIRMED: "Confirmada",
};
const number = (value, nullable = false) =>
  value === "" && nullable ? null : Number(value);
function prescriptionPayload(form, includeReason = false) {
  return {
    fulfillmentNotes: form.fulfillmentNotes || null,
    leftEye: {
      addition: number(form.leftEye.addition, true),
      axis: number(form.leftEye.axis, true),
      cylinder: number(form.leftEye.cylinder),
      sphere: number(form.leftEye.sphere),
    },
    pupillaryDistance: number(form.pupillaryDistance, true),
    ...(includeReason
      ? { replacementReason: form.replacementReason || null }
      : {}),
    rightEye: {
      addition: number(form.rightEye.addition, true),
      axis: number(form.rightEye.axis, true),
      cylinder: number(form.rightEye.cylinder),
      sphere: number(form.rightEye.sphere),
    },
  };
}

export default function ClinicalRecordPage() {
  const actor = useInternalActor();
  const [appointments, setAppointments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [encounter, setEncounter] = useState(null);
  const [encounterForm, setEncounterForm] = useState(EMPTY_ENCOUNTER);
  const [record, setRecord] = useState(EMPTY_RECORD);
  const [history, setHistory] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [prescription, setPrescription] = useState(EMPTY_PRESCRIPTION);
  const [addendum, setAddendum] = useState({ content: "", reason: "" });
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const activePrescription = useMemo(
    () =>
      prescriptions.find(
        (item) =>
          item.encounterId === encounter?.id && item.status === "ACTIVE",
      ) ?? null,
    [encounter, prescriptions],
  );

  useEffect(() => {
    if (!actor?.permissions.includes("medical_records.read_assigned")) return;
    const controller = new AbortController();
    const from = new Date();
    from.setDate(from.getDate() - 90);
    const to = new Date();
    to.setDate(to.getDate() + 45);
    fetch(
      `/api/appointments?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      { signal: controller.signal },
    )
      .then(readResponse)
      .then((data) => {
        setAppointments(
          data.filter((item) =>
            ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(item.status),
          ),
        );
        setStatus("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setNotice({ kind: "error", text: error.message });
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [actor]);

  async function openAppointment(appointment) {
    setSelected(appointment);
    setStatus("loading-detail");
    setNotice(null);
    setEncounter(null);
    setPrescription(EMPTY_PRESCRIPTION);
    try {
      const [recordData, historyData, encounterData, prescriptionData] =
        await Promise.all([
          readResponse(
            await fetch(
              `/api/patients/${appointment.patient.id}/medical-record`,
              { cache: "no-store" },
            ),
          ),
          readResponse(
            await fetch(
              `/api/patients/${appointment.patient.id}/clinical-history`,
              { cache: "no-store" },
            ),
          ),
          readResponse(
            await fetch(
              `/api/clinical-encounters?appointmentId=${appointment.id}`,
              { cache: "no-store" },
            ),
          ),
          readResponse(
            await fetch(
              `/api/prescriptions?patientId=${appointment.patient.id}`,
              { cache: "no-store" },
            ),
          ),
        ]);
      setRecord({ ...EMPTY_RECORD, ...(recordData.record ?? {}) });
      setHistory(historyData.encounters);
      setEncounter(encounterData);
      setPrescriptions(prescriptionData);
      if (encounterData)
        setEncounterForm({
          anamnesis: encounterData.anamnesis ?? "",
          diagnosis: encounterData.diagnosis ?? "",
          examination: encounterData.examination ?? "",
          indications: encounterData.indications ?? "",
          reasonForVisit: encounterData.reasonForVisit ?? "",
        });
      const currentPrescription = prescriptionData.find(
        (item) =>
          item.encounterId === encounterData?.id && item.status === "ACTIVE",
      );
      if (currentPrescription)
        setPrescription({
          fulfillmentNotes: currentPrescription.fulfillmentNotes ?? "",
          leftEye: Object.fromEntries(
            Object.entries(currentPrescription.leftEye).map(([key, value]) => [
              key,
              value ?? "",
            ]),
          ),
          pupillaryDistance: currentPrescription.pupillaryDistance ?? "",
          replacementReason: "",
          rightEye: Object.fromEntries(
            Object.entries(currentPrescription.rightEye).map(([key, value]) => [
              key,
              value ?? "",
            ]),
          ),
        });
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("ready");
    }
  }

  async function markPresent() {
    await perform(async () => {
      const updated = await readResponse(
        await fetch(`/api/appointments/${selected.id}/status`, {
          body: JSON.stringify({ status: "CHECKED_IN" }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
      setSelected(updated);
      setAppointments((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
    }, "Paciente marcado como presente. Ya puede iniciar la atención.");
  }
  async function createEncounter(event) {
    event.preventDefault();
    await perform(async () => {
      const created = await readResponse(
        await fetch("/api/clinical-encounters", {
          body: JSON.stringify({
            appointmentId: selected.id,
            ...encounterForm,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setEncounter(created);
    }, "Atención clínica iniciada como borrador.");
  }
  async function saveEncounter(event) {
    event.preventDefault();
    await perform(async () => {
      const saved = await readResponse(
        await fetch(`/api/clinical-encounters/${encounter.id}`, {
          body: JSON.stringify(encounterForm),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
      setEncounter(saved);
    }, "Borrador clínico guardado con historial de cambios.");
  }
  async function saveRecord(event) {
    event.preventDefault();
    await perform(async () => {
      const saved = await readResponse(
        await fetch(`/api/patients/${selected.patient.id}/medical-record`, {
          body: JSON.stringify(record),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
      setRecord({ ...EMPTY_RECORD, ...saved });
    }, "Antecedentes actualizados y auditados.");
  }
  async function savePrescription(event) {
    event.preventDefault();
    await perform(
      async () => {
        const response =
          activePrescription && encounter.status === "DRAFT"
            ? await fetch(`/api/prescriptions/${activePrescription.id}`, {
                body: JSON.stringify(prescriptionPayload(prescription)),
                headers: { "Content-Type": "application/json" },
                method: "PATCH",
              })
            : await fetch(
                `/api/clinical-encounters/${encounter.id}/prescriptions`,
                {
                  body: JSON.stringify(
                    prescriptionPayload(
                      prescription,
                      Boolean(activePrescription),
                    ),
                  ),
                  headers: { "Content-Type": "application/json" },
                  method: "POST",
                },
              );
        const saved = await readResponse(response);
        setPrescriptions((items) => [
          saved,
          ...items.filter(
            (item) =>
              item.id !== saved.id &&
              !(
                item.encounterId === saved.encounterId &&
                item.status === "ACTIVE"
              ),
          ),
        ]);
      },
      activePrescription
        ? "Receta óptica actualizada o reemplazada con trazabilidad."
        : "Receta óptica emitida.",
    );
  }
  async function finalize() {
    if (
      !window.confirm(
        "Finalizar hace inmutable la atención. Después solo se permiten adendas permanentes. ¿Continuar?",
      )
    )
      return;
    await perform(async () => {
      const saved = await readResponse(
        await fetch(`/api/clinical-encounters/${encounter.id}/finalize`, {
          method: "POST",
        }),
      );
      setEncounter(saved);
      setSelected((value) => ({ ...value, status: "COMPLETED" }));
      setAppointments((items) =>
        items.map((item) =>
          item.id === selected.id ? { ...item, status: "COMPLETED" } : item,
        ),
      );
    }, "Atención finalizada. El registro ahora es inmutable.");
  }
  async function addPermanentAddendum(event) {
    event.preventDefault();
    await perform(async () => {
      const saved = await readResponse(
        await fetch(`/api/clinical-encounters/${encounter.id}/addenda`, {
          body: JSON.stringify(addendum),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setEncounter((value) => ({
        ...value,
        addenda: [...(value.addenda ?? []), saved],
      }));
      setAddendum({ content: "", reason: "" });
    }, "Adenda permanente agregada.");
  }
  async function perform(action, success) {
    setStatus("saving");
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setStatus("ready");
    }
  }
  function eye(side, field, value) {
    setPrescription((current) => ({
      ...current,
      [side]: { ...current[side], [field]: value },
    }));
  }

  if (actor && !actor.permissions.includes("medical_records.read_assigned"))
    return (
      <section className="app-card empty-module">
        <h2>Acceso clínico restringido</h2>
        <p>Ventas y Administración no pueden consultar fichas clínicas.</p>
      </section>
    );
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
        <span className="status-chip">Historial permanente</span>
      </header>
      {notice && (
        <p
          className={
            notice.kind === "error" ? "inline-error" : "inline-success"
          }
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
                        type="submit"
                      >
                        Crear borrador clínico
                      </button>
                    </div>
                  </form>
                )}
              </section>
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
                        disabled={selected.status === "CONFIRMED"}
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
                      type="submit"
                    >
                      Guardar antecedentes
                    </button>
                  </div>
                )}
              </form>
              {encounter && (
                <form
                  className="app-card clinical-section"
                  onSubmit={saveEncounter}
                >
                  <div className="editor-heading">
                    <div>
                      <p className="eyebrow">
                        Atención{" "}
                        {encounter.status === "DRAFT"
                          ? "en borrador"
                          : "finalizada"}
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
                          disabled={encounter.status !== "DRAFT"}
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
                        type="submit"
                      >
                        Guardar borrador
                      </button>
                      <button
                        className="app-button app-button--primary"
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
                            {item.authoredBy.firstName}{" "}
                            {item.authoredBy.lastName}
                          </small>
                        </article>
                      ))}
                      <div>
                        <div className="management-fields">
                          <label className="field">
                            <span>Motivo de la adenda</span>
                            <input
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
              {encounter && (
                <form
                  className="app-card clinical-section"
                  onSubmit={savePrescription}
                >
                  <h2>Receta óptica</h2>
                  <p>
                    {activePrescription
                      ? `Versión activa ${activePrescription.version}.`
                      : "La receta es opcional y se emite solo si corresponde."}
                  </p>
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
                              disabled={
                                encounter.status !== "DRAFT" &&
                                !activePrescription
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
                  <div className="management-fields">
                    <label className="field">
                      <span>Distancia pupilar</span>
                      <input
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
                </form>
              )}
              {history.length > 0 && (
                <section className="app-card clinical-section">
                  <h2>Historial finalizado</h2>
                  <div className="history-list">
                    {history.map((item) => (
                      <article className="history-entry" key={item.id}>
                        <strong>
                          {new Date(item.finalizedAt).toLocaleDateString(
                            "es-CL",
                          )}{" "}
                          · {item.diagnosis}
                        </strong>
                        <small>
                          {item.professional.firstName}{" "}
                          {item.professional.lastName} · {item.reasonForVisit}
                        </small>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
