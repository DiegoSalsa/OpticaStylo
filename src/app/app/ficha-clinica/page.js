"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import "../management.css";
import "./clinical.css";
import ClinicalInterface from "./clinical-interface";
import {
  cloneForm,
  EMPTY_ENCOUNTER,
  EMPTY_PRESCRIPTION,
  EMPTY_RECORD,
  formsMatch,
  medicalRecordForm,
  prescriptionForm,
  prescriptionPayload,
} from "./clinical-form-model";

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
  const [savedPrescription, setSavedPrescription] =
    useState(EMPTY_PRESCRIPTION);
  const [savedEncounterForm, setSavedEncounterForm] = useState(EMPTY_ENCOUNTER);
  const [addendum, setAddendum] = useState({ content: "", reason: "" });
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const detailController = useRef(null);
  const operationInProgress = useRef(false);
  const openAppointmentRef = useRef(null);
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
        const availableAppointments = data.filter((item) =>
          ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(item.status),
        );
        const requestedAppointmentId = new URLSearchParams(
          window.location.search,
        ).get("appointmentId");
        const requestedAppointment = availableAppointments.find(
          (item) => item.id === requestedAppointmentId,
        );

        setAppointments(availableAppointments);
        if (requestedAppointment) {
          void openAppointmentRef.current?.(requestedAppointment);
        } else {
          setStatus("ready");
        }
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
    if (appointment.id === selected?.id || busy || operationInProgress.current)
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
  useEffect(() => {
    openAppointmentRef.current = openAppointment;
  });

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
    <ClinicalInterface
      model={{
        activePrescription,
        addendum,
        addPermanentAddendum,
        appointments,
        busy,
        createEncounter,
        encounter,
        encounterDirty,
        encounterForm,
        encounterPrescriptions,
        eye,
        finalize,
        hasUnsavedChanges,
        history,
        markPresent,
        notice,
        openAppointment,
        prescription,
        prescriptions,
        record,
        recordDirty,
        recordRevisions,
        saveEncounter,
        savePrescription,
        saveRecord,
        selected,
        setAddendum,
        setEncounterForm,
        setPrescription,
        setRecord,
        status,
      }}
    />
  );
}
