"use client";

import RutInput from "@/components/ui/rut-input";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import { normalizeChileanRut } from "@/utils/chilean-rut";
import { readStoreResponse } from "@/utils/store-client";
import { PUBLIC_BOOKING_CONFIRMATION_NOTE } from "./booking-copy";
import { clearBookingDraft, readBookingDraft, saveBookingDraft } from "./booking-draft";
import BookingLogin from "./booking-login";
import styles from "./booking.module.css";

function chileDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(date);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }).format(new Date(value));
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function isMinor(birthDate) {
  if (!birthDate) return false;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const adultDate = new Date(birth);
  adultDate.setUTCFullYear(adultDate.getUTCFullYear() + 18);
  return adultDate > new Date();
}

async function readApi(response) {
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.error?.message || "No fue posible completar la solicitud.");
  return payload.data;
}

export default function BookingExperience({ accountProfile, accountHoursHref, onBooked } = {}) {
  const [professionals, setProfessionals] = useState([]);
  const [professionalId, setProfessionalId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [rut, setRut] = useState("");
  const [account, setAccount] = useState(accountProfile);
  const [status, setStatus] = useState("loading-professionals");
  const [message, setMessage] = useState("");
  const [identityConflict, setIdentityConflict] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const availabilityRequest = useRef(null);
  const bookingForm = useRef(null);
  const prefilled = useRef(null);
  const selectedProfessional = useMemo(() => professionals.find((item) => item.id === professionalId), [professionalId, professionals]);
  const minor = isMinor(birthDate);
  const normalizedRut = normalizeChileanRut(rut);
  const matchesAccount = normalizedRut && normalizedRut === normalizeChileanRut(account?.rut);

  useEffect(() => {
    if (accountProfile) return;
    const controller = new AbortController();
    fetch("/api/store/accounts/me", { cache: "no-store", signal: controller.signal })
      .then(readStoreResponse)
      .then(setAccount)
      .catch((error) => { if (error.name !== "AbortError") setAccount(null); });
    return () => controller.abort();
  }, [accountProfile]);

  function changeRut(event) {
    const value = event.target.value;
    if (prefilled.current && normalizeChileanRut(value) !== normalizeChileanRut(account?.rut)) {
      for (const [name, previous] of Object.entries(prefilled.current)) {
        const field = bookingForm.current.elements.namedItem(name);
        if (field.value === previous) field.value = "";
      }
      prefilled.current = null;
    }
    setRut(value);
    if (identityConflict) setMessage("");
    setIdentityConflict(false);
  }

  function useAccountDetails() {
    if (!matchesAccount && !(accountProfile && !rut.trim())) return;
    if (!matchesAccount) setRut(accountProfile.rut);
    const details = {};
    for (const name of ["firstNames", "lastNames", "email", "phone", "address"]) {
      const field = bookingForm.current.elements.namedItem(name);
      if (field.value || !account[name]) continue;
      field.value = account[name];
      details[name] = account[name];
    }
    prefilled.current = { ...prefilled.current, ...details };
  }

  const loadSlots = useCallback(async (nextProfessionalId, nextDate, previousStartAt = null) => {
    // Invalidar siempre la selección anterior, incluso si se limpia profesional o fecha.
    availabilityRequest.current?.abort();
    setMessage(""); setSelectedSlot(null); setSlots([]); setSelectionNotice("");
    if (!nextProfessionalId || !nextDate) { setStatus("ready"); return; }
    const controller = new AbortController();
    availabilityRequest.current = controller;
    setStatus("loading-slots");
    try {
      const data = await readApi(await fetch(`/api/store/booking/professionals/${nextProfessionalId}/availability?date=${nextDate}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      }));
      if (!controller.signal.aborted) {
        setSlots(data.slots);
        if (previousStartAt) {
          const availableSlot = data.slots.find((slot) => Date.parse(slot.startAt) === Date.parse(previousStartAt));
          setSelectedSlot(availableSlot ?? null);
          if (!availableSlot) {
            clearBookingDraft();
            setSelectionNotice("La hora que habías seleccionado ya no está disponible. Elige otra hora.");
          }
        }
        setStatus("ready");
      }
    } catch {
      if (!controller.signal.aborted) { setMessage("No fue posible consultar los horarios. Vuelve a seleccionar la fecha para reintentar."); setStatus("error-slots"); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let knownProfessionals = null;
    function restoreSelection(data) {
      const draft = readBookingDraft();
      if (!draft) {
        setSelectedSlot(null);
        setStatus("ready");
        return;
      }
      if (!data.some((item) => item.id === draft.professionalId) || draft.date < chileDate(1) || draft.date > chileDate(60)) {
        clearBookingDraft();
        setSelectedSlot(null);
        setSlots([]);
        setSelectionNotice("La hora que habías seleccionado ya no está disponible. Elige otra hora.");
        setStatus("ready");
        return;
      }
      setProfessionalId(draft.professionalId);
      setSelectedDate(draft.date);
      return loadSlots(draft.professionalId, draft.date, draft.startAt);
    }

    function onPageShow(event) {
      // Al volver desde la caché de navegación se conserva la vista, pero no su disponibilidad.
      if (event.persisted && knownProfessionals) void restoreSelection(knownProfessionals);
    }
    window.addEventListener("pageshow", onPageShow);
    fetch("/api/store/booking/professionals", { signal: controller.signal })
      .then(readApi)
      .then((data) => {
        if (controller.signal.aborted) return;
        knownProfessionals = data;
        setProfessionals(data);
        return restoreSelection(data);
      })
      .catch((error) => { if (!controller.signal.aborted) { setMessage(error.message); setStatus("error"); } });
    return () => {
      controller.abort();
      availabilityRequest.current?.abort();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loadSlots]);

  function chooseProfessional(value) {
    clearBookingDraft();
    setProfessionalId(value);
    loadSlots(value, selectedDate);
  }

  function chooseDate(value) {
    clearBookingDraft();
    setSelectedDate(value);
    loadSlots(professionalId, value);
  }

  function chooseSlot(slot) {
    saveBookingDraft({ professionalId, date: selectedDate, startAt: slot.startAt });
    setSelectedSlot(slot);
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (!professionalId || !selectedSlot) { setMessage("Seleccione un profesional y una hora disponible."); return; }
    const form = new FormData(event.currentTarget);
    const patient = {
      address: form.get("address"), birthDate: form.get("birthDate"), email: form.get("email"),
      firstNames: form.get("firstNames"), lastNames: form.get("lastNames"), phone: form.get("phone"), rut: form.get("rut"),
    };
    if (minor) patient.guardian = {
      email: form.get("guardianEmail"), firstNames: form.get("guardianFirstNames"), lastNames: form.get("guardianLastNames"),
      phone: form.get("guardianPhone"), relationship: form.get("guardianRelationship"), rut: form.get("guardianRut"),
    };
    setStatus("submitting"); setMessage(""); setIdentityConflict(false);
    try {
      const data = await readStoreResponse(await fetch("/api/store/booking", {
        body: JSON.stringify({ acceptsPrivacy: form.get("acceptsPrivacy") === "on", patient, professionalId, startAt: selectedSlot.startAt, website: form.get("website") }),
        headers: { "content-type": "application/json" }, method: "POST",
      }));
      clearBookingDraft();
      setConfirmation(data.appointment); setStatus("confirmed");
      onBooked?.();
    } catch (error) {
      setIdentityConflict(error.code === "PUBLIC_BOOKING_IDENTITY_NOT_VERIFIED");
      setMessage(error.message);
      setStatus("ready");
    }
  }

  if (confirmation) {
    return <section className={styles.confirmation}><span><Icon name="check" size={32} /></span><p className="eyebrow">Reserva confirmada</p><h2>Tu hora quedó agendada</h2><p>Te esperamos el {new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(confirmation.startAt))}.</p><dl><div><dt>Profesional</dt><dd>{confirmation.professional.firstName} {confirmation.professional.lastName}</dd></div><div><dt>Referencia</dt><dd>{confirmation.id}</dd></div></dl><p className={styles.confirmationNote}>{PUBLIC_BOOKING_CONFIRMATION_NOTE}</p>{accountHoursHref && <Link className="button button--primary" href={accountHoursHref}>Volver a Mis horas</Link>}</section>;
  }

  return (
    <div className={styles.experience}>
      <section className={styles.scheduler}>
        <div className={styles.stepHeading}><span>1</span><div><h2>Elige profesional y fecha</h2><p>Mostramos únicamente horas realmente disponibles.</p></div></div>
        {status === "loading-professionals" && <div className={styles.inlineState}>Cargando profesionales…</div>}
        {status === "error" && <div className={styles.inlineError}><Icon name="shield" /><p>{message}</p></div>}
        {status !== "loading-professionals" && <div className={styles.field}><label htmlFor="professional">Profesional</label><select id="professional" onChange={(event) => chooseProfessional(event.target.value)} required value={professionalId}><option value="">Selecciona un profesional</option>{professionals.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}</select></div>}
        <div className={styles.field}><label htmlFor="booking-date">Fecha</label><input id="booking-date" max={chileDate(60)} min={chileDate(1)} onChange={(event) => chooseDate(event.target.value)} required type="date" value={selectedDate} /></div>
        <div className={styles.slotArea}><div className={styles.slotLabel}><span>Horas disponibles</span>{selectedDate && <small>{formatLongDate(selectedDate)}</small>}</div>{status === "loading-slots" && <div className={styles.inlineState}>Consultando agenda…</div>}{status === "error-slots" && <div className={styles.inlineError}><Icon name="shield" /><p>{message}</p></div>}{status === "ready" && professionalId && selectedDate && slots.length === 0 && <div className={styles.inlineState}>No hay horas disponibles para esta fecha.</div>}{slots.length > 0 && <div className={styles.slots}>{slots.map((slot) => <button className={selectedSlot?.startAt === slot.startAt ? styles.slotActive : ""} key={slot.startAt} onClick={() => chooseSlot(slot)} type="button">{formatTime(slot.startAt)}</button>)}</div>}</div>
        {selectionNotice && !selectedSlot && <p className={styles.inlineState} role="status">{selectionNotice}</p>}
        <div className={styles.summary}><Icon name="calendar" /><div><small>Tu selección</small><strong>{selectedProfessional ? `${selectedProfessional.firstName} ${selectedProfessional.lastName}` : "Selecciona un profesional"}</strong><span>{selectedSlot ? `${formatLongDate(selectedDate)}, ${formatTime(selectedSlot.startAt)}` : "Selecciona fecha y hora"}</span></div></div>
      </section>

      <section className={styles.details}>
        <div className={styles.stepHeading}><span>2</span><div><h2>Datos de la persona atendida</h2><p>Los usaremos para crear o validar su registro de paciente.</p></div></div>
        <div className={styles.field}>
          <label htmlFor="rut">RUT</label>
          <RutInput id="rut" name="rut" form="booking-details" onChange={changeRut} placeholder="12.345.678-5" required value={rut} />
        </div>
        {normalizedRut && account === null && <BookingLogin onLogin={setAccount} />}
        {(matchesAccount || (accountProfile && !rut.trim())) && (
          <div className={styles.accountHelp}>
            <button className="button button--secondary" onClick={useAccountDetails} type="button">Usar datos de mi cuenta</button>
            <p>Confirma tu fecha de nacimiento y, si ya te atendiste, usa el correo de tu ficha de paciente.</p>
          </div>
        )}
        <form id="booking-details" method="post" onSubmit={submitBooking} ref={bookingForm}>
        <div className={styles.fieldGrid}><div className={styles.field}><label htmlFor="firstNames">Nombres</label><input id="firstNames" name="firstNames" placeholder="Nombres del paciente" required /></div><div className={styles.field}><label htmlFor="lastNames">Apellidos</label><input id="lastNames" name="lastNames" placeholder="Apellidos del paciente" required /></div><div className={styles.field}><label htmlFor="birthDate">Fecha de nacimiento</label><input id="birthDate" max={chileDate()} name="birthDate" onChange={(event) => setBirthDate(event.target.value)} required type="date" value={birthDate} /></div><div className={styles.field}><label htmlFor="email">Correo</label><input id="email" name="email" placeholder="nombre@correo.cl" required type="email" /></div><div className={styles.field}><label htmlFor="phone">Teléfono</label><input id="phone" name="phone" placeholder="+56 9 1234 5678" required type="tel" /></div><div className={`${styles.field} ${styles.fieldWide}`}><label htmlFor="address">Dirección</label><input id="address" name="address" placeholder="Dirección" required /></div></div>
        {minor && <fieldset className={styles.guardian}><legend>Responsable del paciente menor de edad</legend><div className={styles.fieldGrid}><div className={styles.field}><label htmlFor="guardianFirstNames">Nombres</label><input id="guardianFirstNames" name="guardianFirstNames" placeholder="Nombres del responsable" required /></div><div className={styles.field}><label htmlFor="guardianLastNames">Apellidos</label><input id="guardianLastNames" name="guardianLastNames" placeholder="Apellidos del responsable" required /></div><div className={styles.field}><label htmlFor="guardianRut">RUT</label><RutInput id="guardianRut" name="guardianRut" placeholder="12.345.678-5" required /></div><div className={styles.field}><label htmlFor="guardianRelationship">Parentesco</label><input id="guardianRelationship" name="guardianRelationship" placeholder="Madre, padre o tutor" required /></div><div className={styles.field}><label htmlFor="guardianEmail">Correo</label><input id="guardianEmail" name="guardianEmail" placeholder="nombre@correo.cl" required type="email" /></div><div className={styles.field}><label htmlFor="guardianPhone">Teléfono</label><input id="guardianPhone" name="guardianPhone" placeholder="+56 9 1234 5678" required type="tel" /></div></div></fieldset>}
        <input aria-hidden="true" autoComplete="off" className={styles.honeypot} name="website" tabIndex="-1" />
        <label className={styles.consent}><input name="acceptsPrivacy" required type="checkbox" /><span>Acepto que Óptica Stylo trate estos datos para gestionar la reserva y la atención.</span></label>
        {message && status !== "error" && status !== "error-slots" && <div aria-live="polite" className={styles.submitError}>{message}</div>}
        {identityConflict && <p><Link href="/contacto">Contactar a la óptica</Link></p>}
        <button className="button button--primary" disabled={status === "submitting" || !selectedSlot} type="submit">{status === "submitting" ? "Confirmando…" : "Confirmar reserva"}<Icon name="arrow" /></button>
        </form>
      </section>
    </div>
  );
}
