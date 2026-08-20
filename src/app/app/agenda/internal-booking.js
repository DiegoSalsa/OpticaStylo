"use client";

import { useState } from "react";
import { readResponse } from "@/components/internal/internal-shell";

function chileDate(offsetDays = 1) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(value);
}

function time(value) {
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }).format(new Date(value));
}

export default function InternalBooking({ onCreated, professionals }) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [date, setDate] = useState(chileDate());
  const [slots, setSlots] = useState([]);
  const [startAt, setStartAt] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function searchPatients(event) {
    event.preventDefault();
    setStatus("searching"); setMessage("");
    try {
      const data = await readResponse(await fetch(`/api/patients?search=${encodeURIComponent(query.trim())}&pageSize=20`, { cache: "no-store" }));
      setPatients(data.items); setPatientId(data.items[0]?.id ?? "");
      if (!data.items.length) setMessage("No se encontraron pacientes. Créalo primero en Pacientes.");
    } catch (error) { setMessage(error.message); } finally { setStatus("idle"); }
  }

  async function loadSlots(nextProfessionalId = professionalId, nextDate = date) {
    setProfessionalId(nextProfessionalId); setDate(nextDate); setStartAt(""); setSlots([]);
    if (!nextProfessionalId || !nextDate) return;
    setStatus("loading"); setMessage("");
    try {
      const data = await readResponse(await fetch(`/api/professionals/${nextProfessionalId}/availability?date=${nextDate}`, { cache: "no-store" }));
      setSlots(data.slots);
      if (!data.slots.length) setMessage("No hay horas disponibles para esa fecha.");
    } catch (error) { setMessage(error.message); } finally { setStatus("idle"); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!patientId || !professionalId || !startAt) { setMessage("Selecciona paciente, profesional y hora."); return; }
    const form = new FormData(event.currentTarget);
    setStatus("saving"); setMessage("");
    try {
      await readResponse(await fetch("/api/appointments", { body: JSON.stringify({ internalNotes: form.get("internalNotes") || null, patientId, professionalId, startAt }), headers: { "Content-Type": "application/json" }, method: "POST" }));
      setMessage("Reserva interna creada correctamente."); setStartAt("");
      await loadSlots(); await onCreated();
    } catch (error) { setMessage(error.message); } finally { setStatus("idle"); }
  }

  return <form className="app-card internal-booking" onSubmit={submit}>
    <div><h2>Nueva reserva interna</h2><p>Administración agenda a un paciente existente usando horas realmente disponibles.</p></div>
    <div className="internal-booking-grid">
      <label className="field booking-patient"><span>Buscar paciente</span><span className="inline-search"><input onChange={(event)=>setQuery(event.target.value)} placeholder="RUT o nombre" value={query} /><button className="app-button app-button--soft" disabled={status!=="idle"} onClick={searchPatients} type="button">Buscar</button></span></label>
      <label className="field"><span>Paciente</span><select onChange={(event)=>setPatientId(event.target.value)} required value={patientId}><option value="">Selecciona</option>{patients.map((item)=><option key={item.id} value={item.id}>{item.firstNames} {item.lastNames} · {item.rut}</option>)}</select></label>
      <label className="field"><span>Profesional</span><select onChange={(event)=>loadSlots(event.target.value,date)} required value={professionalId}><option value="">Selecciona</option>{professionals.filter((item)=>item.isBookable).map((item)=><option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}</select></label>
      <label className="field"><span>Fecha</span><input min={chileDate()} onChange={(event)=>loadSlots(professionalId,event.target.value)} required type="date" value={date} /></label>
      <label className="field"><span>Hora disponible</span><select onChange={(event)=>setStartAt(event.target.value)} required value={startAt}><option value="">Selecciona</option>{slots.map((slot)=><option key={slot.startAt} value={slot.startAt}>{time(slot.startAt)}</option>)}</select></label>
      <label className="field booking-notes"><span>Notas internas opcionales</span><input maxLength="1000" name="internalNotes" /></label>
    </div>
    {message&&<p aria-live="polite" className={message.includes("correctamente")?"inline-success":"inline-error"}>{message}</p>}
    <div className="schedule-actions"><button className="app-button app-button--primary" disabled={status!=="idle"||!startAt||!patientId} type="submit">{status==="saving"?"Guardando…":"Crear reserva"}</button></div>
  </form>;
}
