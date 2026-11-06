"use client";

import { useEffect, useRef, useState } from "react";
import { readResponse, useInternalActor } from "@/components/internal/internal-shell";
import { clinicalDateToday, emptyClinicalFormData } from "@/config/clinical-forms";
import { EMPTY_ENCOUNTER, EMPTY_RECORD, EMPTY_PRESCRIPTION, formsMatch, medicalRecordForm, prescriptionForm, prescriptionPayload } from "./clinical-form-model";
import { officialFormForEditing, officialFormPayload } from "./official-form-fields";
import ClinicalInterface from "./clinical-interface";
import "../management.css";
import "./clinical.css";
const blank = () => ({
  ...EMPTY_ENCOUNTER,
  encounterDate: clinicalDateToday(),
  formData: null
});
const edit = e => ({
  ...Object.fromEntries(Object.keys(EMPTY_ENCOUNTER).map(k => [k, e[k] ?? ""])),
  encounterDate: e.encounterDate ?? "",
  formData: officialFormForEditing(e.formData)
});
async function api(url, body, method = "GET", key) {
  return readResponse(await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      ...(body ? {
        "Content-Type": "application/json"
      } : {}),
      ...(key ? {
        "X-Idempotency-Key": key
      } : {})
    },
    ...(body ? {
      body: JSON.stringify(body)
    } : {})
  }));
}
export default function ClinicalRecordPage() {
  const actor = useInternalActor();
  const [directory, setDirectory] = useState({
    items: [],
    page: 1,
    totalPages: 0
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null),
    [appointments, setAppointments] = useState([]),
    [appointmentId, setAppointmentId] = useState("");
  const [encounter, setEncounter] = useState(null),
    [encounterForm, setEncounterForm] = useState(blank),
    [savedEncounter, setSavedEncounter] = useState(blank);
  const [type, setType] = useState("OPTOMETRY"),
    [newDate, setNewDate] = useState(clinicalDateToday),
    [newReason, setNewReason] = useState("");
  const [record, setRecord] = useState(EMPTY_RECORD),
    [savedRecord, setSavedRecord] = useState(EMPTY_RECORD),
    [recordRevision, setRecordRevision] = useState(0),
    [recordRevisions, setRecordRevisions] = useState([]);
  const [history, setHistory] = useState({
      encounters: [],
      page: 1,
      totalPages: 0
    }),
    [prescriptions, setPrescriptions] = useState([]);
  const [prescription, setPrescription] = useState(EMPTY_PRESCRIPTION),
    [savedPrescription, setSavedPrescription] = useState(EMPTY_PRESCRIPTION),
    [addendum, setAddendum] = useState({
      reason: "",
      content: ""
    });
  const [status, setStatus] = useState("loading"),
    [notice, setNotice] = useState(null);
  const operation = useRef(false),
    load = useRef(0),
    directoryLoad = useRef(0),
    startup = useRef(null),
    createKey = useRef(null),
    addendumKey = useRef(null);
  const busy = status === "saving" || status === "loading-detail";
  const recordDirty = !!selected && !formsMatch(record, savedRecord);
  const encounterDirty = !!encounter && encounter.status === "DRAFT" && !encounter.isHistoricalVersion && !formsMatch(encounterForm, savedEncounter);
  const prescriptionDirty = !!encounter && !formsMatch(prescription, savedPrescription);
  const hasUnsavedChanges = recordDirty || encounterDirty || prescriptionDirty || !!addendum.reason || !!addendum.content || !!newReason;
  const activePrescription = prescriptions.find(p => p.encounterId === encounter?.id && p.status === "ACTIVE") ?? null;
  const encounterPrescriptions = prescriptions.filter(p => p.encounterId === encounter?.id).sort((a, b) => b.version - a.version);
  function confirmLeave() {
    return !hasUnsavedChanges || window.confirm("Hay cambios clínicos sin guardar. ¿Descartarlos y continuar?");
  }
  useEffect(() => {
    function unload(e) {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    function navigate(e) {
      const a = e.target.closest?.("a[href]");
      if (!hasUnsavedChanges || !a || a.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey) return;
      if (new URL(a.href).pathname !== window.location.pathname && !window.confirm("Hay cambios clínicos sin guardar. ¿Salir y descartarlos?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [hasUnsavedChanges]);
  useEffect(() => {
    if (!actor?.permissions.includes("medical_records.read_assigned")) return;
    let cancelled = false;
    api("/api/clinical-encounters/patients").then(d => {
      if (!cancelled) {
        setDirectory(d);
        setStatus("ready");
        const requested = new URLSearchParams(window.location.search).get("appointmentId");
        if (requested) api(`/api/appointments/${requested}`).then(a => startup.current?.(a.patient, requested)).catch(e => setNotice({
          kind: "error",
          text: e.message
        }));
      }
    }).catch(e => {
      if (!cancelled) {
        setNotice({
          kind: "error",
          text: e.message
        });
        setStatus("ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actor]);
  async function searchPatients(page = 1) {
    const token = ++directoryLoad.current;
    try {
      const d = await api(`/api/clinical-encounters/patients?search=${encodeURIComponent(search)}&page=${page}`);
      if (token === directoryLoad.current) setDirectory(d);
    } catch (e) {
      setNotice({
        kind: "error",
        text: e.message
      });
    }
  }
  function acceptEncounter(e, rx = prescriptions) {
    setEncounter(e);
    const f = e ? edit(e) : blank();
    setEncounterForm(f);
    setSavedEncounter(f);
    const p = prescriptionForm(rx.find(r => r.encounterId === e?.id && r.status === "ACTIVE"));
    setPrescription(p);
    setSavedPrescription(p);
    setAddendum({
      reason: "",
      content: ""
    });
    addendumKey.current = null;
  }
  async function openPatient(patient, requestedAppointment = "") {
    if (busy || !confirmLeave()) return;
    const token = ++load.current;
    setStatus("loading-detail");
    setNotice(null);
    try {
      const [context, med, h, rx] = await Promise.all([api(`/api/clinical-encounters/patients?patientId=${patient.id}`), api(`/api/patients/${patient.id}/medical-record`), api(`/api/patients/${patient.id}/clinical-history`), api(`/api/prescriptions?patientId=${patient.id}`)]);
      if (token !== load.current) return;
      setSelected({
        patient: context.patient,
        status: "CHECKED_IN"
      });
      setAppointments(context.appointments);
      setAppointmentId(context.appointments.some(a => a.id === requestedAppointment) ? requestedAppointment : "");
      setHistory(h);
      setPrescriptions(rx);
      const r = medicalRecordForm(med.record);
      setRecord(r);
      setSavedRecord(r);
      setRecordRevision(med.record?.revision ?? 0);
      setRecordRevisions(med.revisions ?? []);
      acceptEncounter(null, rx);
      setNewReason("");
      createKey.current = null;
    } catch (e) {
      setNotice({
        kind: "error",
        text: e.message
      });
    } finally {
      if (token === load.current) setStatus("ready");
    }
  }
  useEffect(() => {
    startup.current = openPatient;
  });
  async function openEncounter(id, revision = null) {
    if (busy || !confirmLeave()) return;
    await perform(async () => {
      const e = await api(`/api/clinical-encounters/${id}?patientId=${selected.patient.id}${revision ? `&revision=${revision}` : ""}`);
      acceptEncounter(e);
      setNewReason("");
    }, "Ficha recuperada.");
  }
  async function refreshHistory() {
    setHistory(await api(`/api/patients/${selected.patient.id}/clinical-history?page=${history.page}`));
  }
  async function historyPage(page) {
    if (busy) return;
    await perform(async () => setHistory(await api(`/api/patients/${selected.patient.id}/clinical-history?page=${page}`)), "Historial actualizado.");
  }
  async function perform(action, success) {
    if (operation.current) return;
    operation.current = true;
    setStatus("saving");
    setNotice(null);
    try {
      await action();
      setNotice({
        kind: "success",
        text: success
      });
    } catch (e) {
      setNotice({
        kind: "error",
        text: e.message
      });
    } finally {
      operation.current = false;
      setStatus("ready");
    }
  }
  async function markPresent() {
    await perform(async () => {
      await api(`/api/appointments/${appointmentId}/status`, {
        status: "CHECKED_IN"
      }, "PATCH");
      setAppointments(a => a.map(v => v.id === appointmentId ? {
        ...v,
        status: "CHECKED_IN"
      } : v));
    }, "Paciente marcado presente.");
  }
  async function createEncounter(event) {
    event.preventDefault();
    if (encounter && !confirmLeave()) return;
    await perform(async () => {
      createKey.current ??= crypto.randomUUID();
      const e = await api("/api/clinical-encounters", {
        patientId: selected.patient.id,
        ...(appointmentId ? {
          appointmentId
        } : {}),
        encounterType: type,
        encounterDate: newDate,
        formVersion: 1,
        reasonForVisit: newReason,
        formData: emptyClinicalFormData(type)
      }, "POST", createKey.current);
      acceptEncounter(e);
      setNewReason("");
      createKey.current = null;
      await refreshHistory();
    }, "Borrador creado. Puede completar y guardar por etapas.");
  }
  async function saveEncounter(event) {
    event.preventDefault();
    await perform(async () => {
      const e = await api(`/api/clinical-encounters/${encounter.id}`, {
        ...encounterForm,
        formData: officialFormPayload(encounterForm.formData),
        expectedVersion: encounter.version
      }, "PATCH");
      setEncounter(e);
      const f = edit(e);
      setEncounterForm(f);
      setSavedEncounter(f);
      await refreshHistory();
    }, "Borrador guardado con una nueva versión.");
  }
  async function saveRecord(event) {
    event.preventDefault();
    await perform(async () => {
      const r = await api(`/api/patients/${selected.patient.id}/medical-record`, {
        ...record,
        expectedRevision: recordRevision
      }, "PATCH");
      const f = medicalRecordForm(r);
      setRecord(f);
      setSavedRecord(f);
      setRecordRevision(r.revision);
      const med = await api(`/api/patients/${selected.patient.id}/medical-record`);
      setRecordRevisions(med.revisions);
    }, "Antecedentes guardados y auditados.");
  }
  async function finalize() {
    if (hasUnsavedChanges || !window.confirm("Finalizar hace inmutable esta versión. Después solo se permiten adendas permanentes. ¿Finalizar?")) return;
    await perform(async () => {
      const e = await api(`/api/clinical-encounters/${encounter.id}/finalize`, {
        expectedVersion: encounter.version,
        confirm: true
      }, "POST");
      acceptEncounter(e);
      await refreshHistory();
    }, "Atención finalizada. Las correcciones se registran mediante adendas.");
  }
  async function addPermanentAddendum(event) {
    event.preventDefault();
    await perform(async () => {
      addendumKey.current ??= crypto.randomUUID();
      await api(`/api/clinical-encounters/${encounter.id}/addenda`, addendum, "POST", addendumKey.current);
      acceptEncounter(await api(`/api/clinical-encounters/${encounter.id}`));
    }, "Adenda permanente guardada.");
  }
  async function savePrescription(event) {
    event.preventDefault();
    await perform(async () => {
      const patch = activePrescription && encounter.status === "DRAFT";
      const p = await api(patch ? `/api/prescriptions/${activePrescription.id}` : `/api/clinical-encounters/${encounter.id}/prescriptions`, prescriptionPayload(prescription, !patch && !!activePrescription), patch ? "PATCH" : "POST");
      setPrescriptions(rows => [p, ...rows.filter(r => r.id !== p.id).map(r => r.encounterId === p.encounterId && r.status === "ACTIVE" ? {
        ...r,
        status: "VOIDED"
      } : r)]);
      const f = prescriptionForm(p);
      setPrescription(f);
      setSavedPrescription(f);
    }, "Prescripción óptica guardada por decisión profesional explícita.");
  }
  function eye(side, key, value) {
    setPrescription(p => ({
      ...p,
      [side]: {
        ...p[side],
        [key]: value
      }
    }));
  }
  if (actor && !actor.permissions.includes("medical_records.read_assigned")) return <section className="app-card empty-module">
  <h2>Acceso clínico restringido</h2>
  <p>Se requiere autorización clínica y asignación al paciente.</p>
</section>;
  return <ClinicalInterface model={{
    actor,
    directory,
    search,
    setSearch,
    searchPatients,
    openPatient,
    selected,
    appointments,
    appointmentId,
    setAppointmentId,
    markPresent,
    encounter,
    encounterForm,
    setEncounterForm,
    type,
    setType,
    newDate,
    setNewDate,
    newReason,
    setNewReason,
    createEncounter,
    record,
    setRecord,
    recordDirty,
    recordRevisions,
    saveRecord,
    history,
    historyPage,
    openEncounter,
    prescription,
    setPrescription,
    activePrescription,
    encounterPrescriptions,
    eye,
    savePrescription,
    addendum,
    setAddendum,
    addPermanentAddendum,
    saveEncounter,
    encounterDirty,
    finalize,
    busy,
    status,
    notice,
    hasUnsavedChanges
  }} />;
}
