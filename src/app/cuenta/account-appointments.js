"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readStoreResponse } from "@/utils/store-client";
import { AccountPagination, clinicalRecordsUrl, previewPage, useAccountPage } from "./account-pagination";

const zone = "America/Santiago";
const dateTime = (value) => new Date(value).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: zone });
const time = (value) => new Date(value).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: zone });
const labels = { CANCELLED: "Cancelada", CHECKED_IN: "En atención", COMPLETED: "Atendida", CONFIRMED: "Confirmada", NO_SHOW: "No asistió" };

function AppointmentCard({ appointment, onChanged }) {
  const [action, setAction] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const canChange = appointment.status === "CONFIRMED" && appointment.changeUntil && new Date(appointment.changeUntil) > new Date();

  useEffect(() => {
    if (action !== "RESCHEDULE" || !date) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ date });
    fetch("/api/store/booking/professionals/" + appointment.professionalId + "/availability?" + query, {
      cache: "no-store", signal: controller.signal,
    })
      .then(readStoreResponse)
      .then((data) => { if (!controller.signal.aborted) setSlots(data.slots); })
      .catch((failure) => { if (!controller.signal.aborted) setAvailabilityError(failure.message); });
    return () => controller.abort();
  }, [action, appointment.professionalId, date, retry]);

  function clearAvailability() {
    setSlots(null);
    setSelected("");
    setAvailabilityError("");
  }

  function chooseAction(value) {
    setAction(value);
    setError("");
    setDate("");
    clearAvailability();
  }

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await readStoreResponse(await fetch("/api/store/accounts/me/clinical/appointments/" + appointment.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedStartAt: appointment.startAt, startAt: selected || undefined }),
      }));
      chooseAction("");
      await onChanged(action === "CANCEL" ? "Hora cancelada." : "Hora reagendada.");
    } catch (failure) {
      setError(failure.message);
      if (failure.code === "CUSTOMER_APPOINTMENT_SLOT_TAKEN") {
        clearAvailability();
        setRetry((value) => value + 1);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <details className="clinical-row">
    <summary>{dateTime(appointment.startAt)} · {labels[appointment.status] ?? appointment.status}</summary>
    <p>{appointment.professional ? [appointment.professional.firstName, appointment.professional.lastName].join(" ") : "Profesional de Óptica Stylo"}</p>
    <p>{time(appointment.startAt)} a {time(appointment.endAt)} · Hora de Chile</p>
    <small>Referencia {appointment.id}</small>
    {canChange && <p>Puedes cancelar o reagendar hasta el {dateTime(appointment.changeUntil)}.</p>}
    {!canChange && appointment.status === "CONFIRMED" && <p>Para cambiar esta hora, <Link href="/contacto">contacta a la óptica</Link>.</p>}
    {canChange && !action && <div className="account-card-actions">
      <button className="button button--secondary" type="button" onClick={() => chooseAction("RESCHEDULE")}>Reagendar hora</button>
      <button className="button button--secondary" type="button" onClick={() => chooseAction("CANCEL")}>Cancelar hora</button>
    </div>}
    {action && <form onSubmit={submit} className="account-appointment-form">
      {action === "CANCEL" ? <p>¿Confirmas que quieres cancelar esta hora?</p> : <>
        <label className="field"><span>Nueva fecha</span><input
          type="date" min={new Date().toLocaleDateString("sv-SE", { timeZone: zone })} value={date} required disabled={busy}
          onChange={(event) => { setDate(event.target.value); clearAvailability(); }}
        /></label>
        {date && !availabilityError && !slots && <p role="status">Consultando horas disponibles…</p>}
        {availabilityError && <p role="alert">{availabilityError} <button type="button" onClick={() => {
          clearAvailability();
          setRetry((value) => value + 1);
        }}>Reintentar</button></p>}
        {slots?.length === 0 && <p>No hay horas disponibles para ese día.</p>}
        {slots?.length > 0 && <label className="field"><span>Nueva hora</span><select
          required disabled={busy} value={selected} onChange={(event) => setSelected(event.target.value)}
        ><option value="">Elige una hora</option>{slots.map((slot) => <option key={slot.startAt} value={slot.startAt}>{time(slot.startAt)}</option>)}</select></label>}
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="account-card-actions">
        <button className="button button--primary" disabled={busy || (action === "RESCHEDULE" && !selected)} type="submit">
          {busy ? "Guardando…" : action === "CANCEL" ? "Confirmar cancelación" : "Confirmar nueva hora"}
        </button>
        <button className="button button--secondary" disabled={busy} type="button" onClick={() => chooseAction("")}>Volver</button>
      </div>
    </form>}
  </details>;
}

export default function AccountAppointments({ clinical, standalone, reload, dependantId, onExpired }) {
  const [notice, setNotice] = useState("");
  const upcoming = useAccountPage(clinicalRecordsUrl("upcoming", dependantId), {
    initialPage: previewPage(clinical.upcomingAppointments, clinical.upcomingPage), onExpired,
  });
  const history = useAccountPage(clinicalRecordsUrl("appointment-history", dependantId), { onExpired });
  const onChanged = async (message) => {
    setNotice(message);
    upcoming.reload();
    history.reload();
    await reload();
  };
  return <section id="horas">
    {standalone ? <h2>Mis horas</h2> : <h3>Mis horas</h3>}
    <Link className="button button--secondary" href="/cuenta?seccion=reservar">Agendar una hora</Link>
    {notice && <p role="status">{notice}</p>}
    <h4>Próximas horas</h4>
    {upcoming.items.map((appointment) =>
      <AppointmentCard appointment={appointment} key={appointment.id + appointment.startAt} onChanged={onChanged} />
    )}
    {upcoming.status === "ready" && !upcoming.total && <p className="clinical-empty">No tienes próximas horas agendadas.</p>}
    <AccountPagination list={upcoming} label="próximas horas" />
    <h4>Historial</h4>
    <label className="field">
      <span>Estado de las citas anteriores</span>
      <select value={history.filters.status ?? ""} onChange={(event) => history.setFilters({ status: event.target.value })}>
        <option value="">Todos los estados</option>
        {Object.entries(labels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
      </select>
    </label>
    {history.items.map((appointment) =>
      <AppointmentCard appointment={appointment} key={appointment.id} onChanged={onChanged} />
    )}
    {history.status === "ready" && !history.total && <p className="clinical-empty">No hay citas anteriores para esta consulta.</p>}
    <AccountPagination list={history} label="citas anteriores" />
  </section>;
}
