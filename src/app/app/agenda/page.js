"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import Icon from "@/components/ui/icon";
import InternalBooking from "./internal-booking";
import ProfessionalManager from "./professional-manager";
import "./agenda.css";

const DAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const STATUS = {
  CANCELLED: "Cancelada",
  CHECKED_IN: "Presente",
  COMPLETED: "Completada",
  CONFIRMED: "Confirmada",
  NO_SHOW: "No asistió",
};
const defaultWeek = () =>
  DAYS.map((_, dayOfWeek) => ({
    breakEnd: "14:00",
    breakStart: "13:00",
    dayOfWeek,
    endTime: "18:00",
    isWorking: false,
    startTime: "09:00",
  }));
const dateOnly = (value) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(
    value,
  );

export default function AgendaPage() {
  const actor = useInternalActor();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(dateOnly(today));
  const [to, setTo] = useState(() => {
    const value = new Date(today);
    value.setDate(value.getDate() + 30);
    return dateOnly(value);
  });
  const [professionals, setProfessionals] = useState([]);
  const [professionalId, setProfessionalId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [appointments, setAppointments] = useState([]);
  const [week, setWeek] = useState(defaultWeek);
  const [blocks, setBlocks] = useState([]);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const canManageAll = actor?.permissions.includes("schedules.manage_all");
  const canManageSelected =
    actor &&
    professionalId &&
    (canManageAll || professionalId === actor.userId);
  const range = useMemo(
    () => ({
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  );

  useEffect(() => {
    if (!actor?.permissions.includes("schedules.read")) return;
    const controller = new AbortController();
    fetch("/api/professionals", { signal: controller.signal })
      .then(readResponse)
      .then((items) => {
        setProfessionals(items);
        const own = items.find((item) => item.id === actor.userId);
        setProfessionalId(own?.id ?? items[0]?.id ?? "");
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setNotice({ kind: "error", text: error.message });
      });
    return () => controller.abort();
  }, [actor]);

  const loadAppointments = useCallback(
    async (signal) => {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (professionalId) params.set("professionalId", professionalId);
      if (filterStatus) params.set("status", filterStatus);
      return readResponse(
        await fetch(`/api/appointments?${params}`, {
          cache: "no-store",
          signal,
        }),
      );
    },
    [filterStatus, professionalId, range],
  );

  const loadSchedule = useCallback(
    async (signal) => {
      if (!professionalId) return { blocks: [], week: defaultWeek() };
      const [schedule, scheduleBlocks] = await Promise.all([
        readResponse(
          await fetch(`/api/professionals/${professionalId}/schedule`, {
            cache: "no-store",
            signal,
          }),
        ),
        readResponse(
          await fetch(
            `/api/professionals/${professionalId}/schedule/blocks?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
            { cache: "no-store", signal },
          ),
        ),
      ]);
      const byDay = new Map(schedule.map((day) => [day.dayOfWeek, day]));
      return {
        blocks: scheduleBlocks,
        week: defaultWeek().map((day) => ({
          ...day,
          ...(byDay.get(day.dayOfWeek) ?? {}),
        })),
      };
    },
    [professionalId, range],
  );

  useEffect(() => {
    if (!actor || !professionalId) return;
    const controller = new AbortController();
    Promise.all([
      loadAppointments(controller.signal),
      loadSchedule(controller.signal),
    ])
      .then(([appointmentItems, schedule]) => {
        setAppointments(appointmentItems);
        setWeek(schedule.week);
        setBlocks(schedule.blocks);
        setStatus("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setNotice({ kind: "error", text: error.message });
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [actor, loadAppointments, loadSchedule, professionalId]);

  async function refresh() {
    setStatus("loading");
    setNotice(null);
    try {
      const [items, schedule] = await Promise.all([
        loadAppointments(),
        loadSchedule(),
      ]);
      setAppointments(items);
      setWeek(schedule.week);
      setBlocks(schedule.blocks);
      setStatus("ready");
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
      setStatus("error");
    }
  }
  async function changeAppointment(appointment, nextStatus) {
    let cancellationReason;
    if (nextStatus === "CANCELLED") {
      cancellationReason = window.prompt("Motivo obligatorio de cancelación:");
      if (!cancellationReason) return;
    }
    setStatus("saving");
    try {
      const saved = await readResponse(
        await fetch(`/api/appointments/${appointment.id}/status`, {
          body: JSON.stringify({ cancellationReason, status: nextStatus }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
      setAppointments((items) =>
        items.map((item) => (item.id === saved.id ? saved : item)),
      );
      setNotice({
        kind: "success",
        text: `Reserva actualizada a ${STATUS[nextStatus]}.`,
      });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setStatus("ready");
    }
  }
  function updateDay(index, field, value) {
    setWeek((days) =>
      days.map((day, dayIndex) =>
        dayIndex === index ? { ...day, [field]: value } : day,
      ),
    );
  }
  async function saveWeek(event) {
    event.preventDefault();
    setStatus("saving");
    try {
      const saved = await readResponse(
        await fetch(`/api/professionals/${professionalId}/schedule`, {
          body: JSON.stringify({ days: week }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        }),
      );
      setWeek(saved);
      setNotice({ kind: "success", text: "Horario semanal guardado." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setStatus("ready");
    }
  }
  async function createBlock(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("saving");
    try {
      const saved = await readResponse(
        await fetch(`/api/professionals/${professionalId}/schedule/blocks`, {
          body: JSON.stringify({
            endAt: new Date(form.get("endAt")).toISOString(),
            reason: form.get("reason") || null,
            startAt: new Date(form.get("startAt")).toISOString(),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      setBlocks((items) =>
        [...items, saved].sort(
          (a, b) => new Date(a.startAt) - new Date(b.startAt),
        ),
      );
      event.currentTarget.reset();
      setNotice({ kind: "success", text: "Bloqueo agregado a la agenda." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setStatus("ready");
    }
  }
  async function removeBlock(block) {
    if (!window.confirm("¿Eliminar este bloqueo de agenda?")) return;
    try {
      const response = await fetch(
        `/api/professionals/${professionalId}/schedule/blocks/${block.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) await readResponse(response);
      setBlocks((items) => items.filter((item) => item.id !== block.id));
      setNotice({ kind: "success", text: "Bloqueo retirado." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    }
  }

  if (actor && !actor.permissions.includes("schedules.read"))
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>Ventas no administra agenda ni pacientes.</p>
      </section>
    );
  return (
    <>
      <header className="app-heading">
        <div>
          <p className="eyebrow">Atención</p>
          <h1>Agenda</h1>
          <p>Reservas, horarios y bloqueos del equipo clínico.</p>
        </div>
        <Link
          className="app-button app-button--soft"
          href="/reservar"
          target="_blank"
        >
          <Icon name="arrow" size={16} /> Abrir reserva pública
        </Link>
      </header>
      <nav className="agenda-tabs" aria-label="Vistas de agenda"><a href="#agenda-operativa"><Icon name="calendar" size={16} /> Agenda</a><a href="#configuracion-profesionales"><Icon name="settings" size={16} /> Configuración de profesionales</a></nav>
      {notice && (
        <p
          className={
            notice.kind === "error" ? "inline-error" : "inline-success"
          }
        >
          {notice.text}
        </p>
      )}
      <section className="app-card agenda-toolbar">
        <label className="field">
          <span>Profesional</span>
          <select
            disabled={!canManageAll}
            onChange={(event) => setProfessionalId(event.target.value)}
            value={professionalId}
          >
            {professionals.map((item) => (
              <option key={item.id} value={item.id}>
                {item.firstName} {item.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Desde</span>
          <input
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input
            min={from}
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </label>
        <label className="field">
          <span>Estado</span>
          <select
            onChange={(event) => setFilterStatus(event.target.value)}
            value={filterStatus}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="app-button" onClick={refresh} type="button">
          Actualizar
        </button>
      </section>
      {actor?.permissions.includes("appointments.create") && (
        <InternalBooking onCreated={refresh} professionals={professionals} />
      )}
      <div className="agenda-layout" id="agenda-operativa">
        <section className="app-card agenda-list">
          {status === "loading" ? (
            <p className="directory-state">Cargando agenda…</p>
          ) : !appointments.length ? (
            <p className="directory-state">No hay reservas en este rango.</p>
          ) : (
            appointments.map((appointment) => {
              const date = new Date(appointment.startAt);
              return (
                <article className="appointment-card" key={appointment.id}>
                  <div className="appointment-date">
                    <strong>
                      {date.toLocaleTimeString("es-CL", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </strong>
                    <small>
                      {date.toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </small>
                  </div>
                  <div className="appointment-main">
                    <strong>
                      {appointment.patient.firstNames}{" "}
                      {appointment.patient.lastNames}
                    </strong>
                    <small>
                      {appointment.patient.rut} ·{" "}
                      {appointment.professional.firstName}{" "}
                      {appointment.professional.lastName}
                    </small>
                    <small>
                      {STATUS[appointment.status]} · Origen{" "}
                      {appointment.source === "ONLINE" ? "web" : "interno"}
                    </small>
                  </div>
                  <div className="appointment-actions">
                    {appointment.status === "CONFIRMED" && (
                      <>
                        <button
                          className="app-button app-button--primary"
                          disabled={status === "saving"}
                          onClick={() =>
                            changeAppointment(appointment, "CHECKED_IN")
                          }
                          type="button"
                        >
                          Presente
                        </button>
                        <button
                          className="app-button app-button--soft"
                          disabled={status === "saving"}
                          onClick={() =>
                            changeAppointment(appointment, "NO_SHOW")
                          }
                          type="button"
                        >
                          No asistió
                        </button>
                        {actor?.permissions.includes("appointments.cancel") && (
                          <button
                            className="app-button app-button--danger"
                            onClick={() =>
                              changeAppointment(appointment, "CANCELLED")
                            }
                            type="button"
                          >
                            Cancelar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
        <aside className="schedule-panel" id="configuracion-profesionales">
          <form className="app-card schedule-card" onSubmit={saveWeek}>
            <h2>Horario semanal</h2>
            <p>Configura únicamente horarios confirmados por la óptica.</p>
            <div className="week-grid">
              {week.map((day, index) => (
                <div className="week-day" key={day.dayOfWeek}>
                  <strong>{DAYS[day.dayOfWeek]}</strong>
                  <input
                    aria-label={`${DAYS[day.dayOfWeek]} trabaja`}
                    checked={day.isWorking}
                    disabled={!canManageSelected}
                    onChange={(event) =>
                      updateDay(index, "isWorking", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <input
                    aria-label={`${DAYS[day.dayOfWeek]} inicio`}
                    disabled={!canManageSelected || !day.isWorking}
                    onChange={(event) =>
                      updateDay(index, "startTime", event.target.value)
                    }
                    type="time"
                    value={day.startTime ?? "09:00"}
                  />
                  <input
                    aria-label={`${DAYS[day.dayOfWeek]} término`}
                    disabled={!canManageSelected || !day.isWorking}
                    onChange={(event) =>
                      updateDay(index, "endTime", event.target.value)
                    }
                    type="time"
                    value={day.endTime ?? "18:00"}
                  />
                  <input
                    aria-label={`${DAYS[day.dayOfWeek]} inicio pausa`}
                    disabled={!canManageSelected || !day.isWorking}
                    onChange={(event) =>
                      updateDay(index, "breakStart", event.target.value)
                    }
                    type="time"
                    value={day.breakStart ?? ""}
                  />
                  <input
                    aria-label={`${DAYS[day.dayOfWeek]} fin pausa`}
                    disabled={!canManageSelected || !day.isWorking}
                    onChange={(event) =>
                      updateDay(index, "breakEnd", event.target.value)
                    }
                    type="time"
                    value={day.breakEnd ?? ""}
                  />
                </div>
              ))}
            </div>
            {canManageSelected && (
              <div className="schedule-actions">
                <button
                  className="app-button app-button--primary"
                  disabled={status === "saving"}
                  type="submit"
                >
                  Guardar horario
                </button>
              </div>
            )}
          </form>
          <form className="app-card schedule-card" onSubmit={createBlock}>
            <h2>Bloqueos</h2>
            <p>Vacaciones, trámites u otros periodos no reservables.</p>
            <div className="management-fields">
              <label className="field">
                <span>Inicio</span>
                <input
                  disabled={!canManageSelected}
                  name="startAt"
                  required
                  type="datetime-local"
                />
              </label>
              <label className="field">
                <span>Término</span>
                <input
                  disabled={!canManageSelected}
                  name="endAt"
                  required
                  type="datetime-local"
                />
              </label>
              <label className="field field-wide">
                <span>Motivo opcional</span>
                <input
                  disabled={!canManageSelected}
                  maxLength="500"
                  name="reason"
                />
              </label>
            </div>
            {canManageSelected && (
              <div className="schedule-actions">
                <button className="app-button app-button--soft" type="submit">
                  Agregar bloqueo
                </button>
              </div>
            )}
            <div className="block-list">
              {blocks.map((block) => (
                <div className="block-item" key={block.id}>
                  <span>
                    {new Date(block.startAt).toLocaleString("es-CL")} –{" "}
                    {new Date(block.endAt).toLocaleString("es-CL")}
                    <br />
                    {block.reason ?? "Sin motivo registrado"}
                  </span>
                  {canManageSelected && (
                    <button onClick={() => removeBlock(block)} type="button">
                      Eliminar
                    </button>
                  )}
                </div>
              ))}
            </div>
          </form>
        </aside>
      </div>
      {canManageAll && <div className="professional-config-panel"><ProfessionalManager onChanged={setProfessionals} professionals={professionals} /></div>}
    </>
  );
}
