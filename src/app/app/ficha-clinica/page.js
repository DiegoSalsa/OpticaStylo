"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const FIELD_LABELS = Object.fromEntries(RECORD_FIELDS);
const LABELS = {
  CHECKED_IN: "Presente",
  COMPLETED: "Completada",
  CONFIRMED: "Confirmada",
};
const number = (value, nullable = false) =>
  value === "" && nullable ? null : Number(value);
const cloneForm = (value) => structuredClone(value);
const formsMatch = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function medicalRecordForm(record) {
  return Object.fromEntries(
    RECORD_FIELDS.map(([field]) => [field, record?.[field] ?? ""]),
  );
}
function prescriptionForm(currentPrescription) {
  if (!currentPrescription) return cloneForm(EMPTY_PRESCRIPTION);

  return {
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
  };
}
function formatOpticalValue(value, { axis = false } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  if (axis) return `${value}°`;
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}`;
}
function PrescriptionVersion({ item }) {
  return (
    <article className="prescription-version">
      <header>
        <strong>Versión {item.version}</strong>
        <span
          className={
            item.status === "ACTIVE"
              ? "status-chip"
              : "status-chip status-chip--muted"
          }
        >
          {item.status === "ACTIVE" ? "Activa" : "Reemplazada"}
        </span>
      </header>
      <div className="prescription-values" role="table">
        <strong>Ojo</strong>
        <strong>Esfera</strong>
        <strong>Cilindro</strong>
        <strong>Eje</strong>
        <strong>Adición</strong>
        {[
          ["OD", item.rightEye],
          ["OI", item.leftEye],
        ].map(([label, eyeData]) => (
          <div key={label} role="row" style={{ display: "contents" }}>
            <b>{label}</b>
            <span>{formatOpticalValue(eyeData.sphere)}</span>
            <span>{formatOpticalValue(eyeData.cylinder)}</span>
            <span>{formatOpticalValue(eyeData.axis, { axis: true })}</span>
            <span>{formatOpticalValue(eyeData.addition)}</span>
          </div>
        ))}
      </div>
      <p>
        DP: {item.pupillaryDistance ?? "No registrada"}
        {item.fulfillmentNotes ? ` · ${item.fulfillmentNotes}` : ""}
      </p>
      <small>
        Emitida el {new Date(item.issuedAt).toLocaleString("es-CL")} por{" "}
        {item.issuedBy.firstName} {item.issuedBy.lastName}
      </small>
      {item.replacementReason && (
        <small>Motivo del reemplazo: {item.replacementReason}</small>
      )}
    </article>
  );
}
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
  const [savedRecord, setSavedRecord] = useState(EMPTY_RECORD);
  const [recordRevisions, setRecordRevisions] = useState([]);
  const [history, setHistory] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [prescription, setPrescription] = useState(EMPTY_PRESCRIPTION);
  const [savedPrescription, setSavedPrescription] = useState(EMPTY_PRESCRIPTION);
  const [savedEncounterForm, setSavedEncounterForm] = useState(EMPTY_ENCOUNTER);
  const [addendum, setAddendum] = useState({ content: "", reason: "" });
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const detailController = useRef(null);
  const operationInProgress = useRef(false);
  const busy = status === "saving";
  const activePrescription = useMemo(
    () =>
      prescriptions.find(
        (item) =>
          item.encounterId === encounter?.id && item.status === "ACTIVE",
      ) ?? null,
    [encounter, prescriptions],
  );
  const encounterPrescriptions = useMemo(
    () =>
      prescriptions
        .filter((item) => item.encounterId === encounter?.id)
        .sort((left, right) => right.version - left.version),
    [encounter, prescriptions],
  );
  const recordDirty = Boolean(selected) && !formsMatch(record, savedRecord);
  const encounterDirty = encounter
    ? encounter.status === "DRAFT" &&
      !formsMatch(encounterForm, savedEncounterForm)
    : selected?.status === "CHECKED_IN" &&
      !formsMatch(encounterForm, EMPTY_ENCOUNTER);
  const prescriptionDirty =
    Boolean(encounter) && !formsMatch(prescription, savedPrescription);
  const addendumDirty = Boolean(
    addendum.reason.trim() || addendum.content.trim(),
  );
  const hasUnsavedChanges =
    recordDirty || encounterDirty || prescriptionDirty || addendumDirty;

  useEffect(() => {
    const warnBeforeUnload = (event) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const warnInternalNavigation = (event) => {
      if (
        !hasUnsavedChanges ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.pathname === window.location.pathname ||
        window.confirm(
          "Hay cambios clínicos sin guardar. Si sale de esta pantalla se perderán. ¿Continuar?",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", warnInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", warnInternalNavigation, true);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => () => detailController.current?.abort(), []);

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
    if (
      appointment.id === selected?.id ||
      busy ||
      operationInProgress.current
    )
      return;
    if (
      hasUnsavedChanges &&
      !window.confirm(
        "Hay cambios clínicos sin guardar. Si cambia de atención se perderán. ¿Continuar?",
      )
    )
      return;

    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelected(appointment);
    setStatus("loading-detail");
    setNotice(null);
    setEncounter(null);
    setPrescription(cloneForm(EMPTY_PRESCRIPTION));
    setSavedPrescription(cloneForm(EMPTY_PRESCRIPTION));
    setAddendum({ content: "", reason: "" });
    setEncounterForm({ ...EMPTY_ENCOUNTER });
    setSavedEncounterForm({ ...EMPTY_ENCOUNTER });
    try {
      const requestOptions = { cache: "no-store", signal: controller.signal };
      const [recordData, historyData, encounterData, prescriptionData] =
        await Promise.all([
          readResponse(
            await fetch(
              `/api/patients/${appointment.patient.id}/medical-record`,
              requestOptions,
            ),
          ),
          readResponse(
            await fetch(
              `/api/patients/${appointment.patient.id}/clinical-history`,
              requestOptions,
            ),
          ),
          readResponse(
            await fetch(
              `/api/clinical-encounters?appointmentId=${appointment.id}`,
              requestOptions,
            ),
          ),
          readResponse(
            await fetch(
              `/api/prescriptions?patientId=${appointment.patient.id}`,
              requestOptions,
            ),
          ),
        ]);
      if (controller.signal.aborted) return;
      const nextRecord = medicalRecordForm(recordData.record);
      setRecord(nextRecord);
      setSavedRecord(nextRecord);
      setRecordRevisions(recordData.revisions ?? []);
      setHistory(historyData.encounters);
      setEncounter(encounterData);
      setPrescriptions(prescriptionData);
      if (encounterData) {
        const nextEncounterForm = {
          anamnesis: encounterData.anamnesis ?? "",
          diagnosis: encounterData.diagnosis ?? "",
          examination: encounterData.examination ?? "",
          indications: encounterData.indications ?? "",
          reasonForVisit: encounterData.reasonForVisit ?? "",
        };
        setEncounterForm(nextEncounterForm);
        setSavedEncounterForm(nextEncounterForm);
      }
      const currentPrescription = prescriptionData.find(
        (item) =>
          item.encounterId === encounterData?.id && item.status === "ACTIVE",
      );
      const nextPrescription = prescriptionForm(currentPrescription);
      setPrescription(nextPrescription);
      setSavedPrescription(nextPrescription);
      setStatus("ready");
    } catch (error) {
      if (error.name === "AbortError") return;
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
      setSavedEncounterForm({ ...encounterForm });
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
      setSavedEncounterForm({ ...encounterForm });
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
      const refreshed = await readResponse(
        await fetch(`/api/patients/${selected.patient.id}/medical-record`, {
          cache: "no-store",
        }),
      );
      const nextRecord = medicalRecordForm(saved);
      setRecord(nextRecord);
      setSavedRecord(nextRecord);
      setRecordRevisions(refreshed.revisions ?? []);
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
        setPrescriptions((items) => {
          const previous = items.map((item) =>
            item.encounterId === saved.encounterId &&
            item.status === "ACTIVE" &&
            item.id !== saved.id
              ? { ...item, status: "VOIDED" }
              : item,
          );
          return [saved, ...previous.filter((item) => item.id !== saved.id)];
        });
        const nextPrescription = prescriptionForm(saved);
        setPrescription(nextPrescription);
        setSavedPrescription(nextPrescription);
      },
      activePrescription
        ? "Receta óptica actualizada o reemplazada con trazabilidad."
        : "Receta óptica emitida.",
    );
  }
  async function finalize() {
    if (hasUnsavedChanges) {
      setNotice({
        kind: "error",
        text: "Guarde los antecedentes, la atención y la receta antes de finalizar.",
      });
      return;
    }
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
      setHistory((items) => [
        saved,
        ...items.filter((item) => item.id !== saved.id),
      ]);
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
      setHistory((items) =>
        items.map((item) =>
          item.id === encounter.id
            ? { ...item, addenda: [...(item.addenda ?? []), saved] }
            : item,
        ),
      );
      setAddendum({ content: "", reason: "" });
    }, "Adenda permanente agregada.");
  }
  async function perform(action, success) {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setStatus("saving");
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      operationInProgress.current = false;
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
                    Cada versión conserva exactamente el contenido que estaba
                    vigente al momento de guardarla.
                  </p>
                  <div className="revision-list">
                    {recordRevisions.map((revision) => (
                      <details key={revision.id}>
                        <summary>
                          <strong>Versión {revision.revision}</strong>
                          <small>
                            {new Date(revision.recordedAt).toLocaleString(
                              "es-CL",
                            )}{" "}
                            · {revision.recordedBy.firstName}{" "}
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
                                  (encounter.status !== "DRAFT" &&
                                    !activePrescription)
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
                          busy ||
                          (encounter.status !== "DRAFT" && !activePrescription)
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
                          busy ||
                          (encounter.status !== "DRAFT" && !activePrescription)
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
                        {encounterPrescriptions.length === 1
                          ? "versión"
                          : "versiones"}
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
                              {new Date(item.finalizedAt).toLocaleDateString(
                                "es-CL",
                              )}{" "}
                              · {item.diagnosis}
                            </strong>
                            <small>
                              {item.professional.firstName}{" "}
                              {item.professional.lastName} ·{" "}
                              {item.reasonForVisit}
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
                                      ).toLocaleString("es-CL")} ·{" "}
                                      {historyAddendum.authoredBy.firstName}{" "}
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
          )}
        </main>
      </div>
    </>
  );
}
