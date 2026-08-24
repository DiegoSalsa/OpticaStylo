"use client";

import Link from "next/link";
import Icon from "@/components/ui/icon";
import {
  canOpenClinicalRecord,
  clinicalRecordHref,
} from "./agenda-calendar-model";

const STATUS = {
  CANCELLED: "Cancelada",
  CHECKED_IN: "Presente",
  COMPLETED: "Completada",
  CONFIRMED: "Confirmada",
  NO_SHOW: "No asistió",
};

function formatDate(value) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  }).format(new Date(value));
}

export default function AgendaCalendar({
  actor,
  days,
  onChangeStatus,
  saving,
}) {
  return (
    <section className="app-card agenda-calendar" aria-label="Calendario de reservas">
      <header className="agenda-calendar__heading">
        <div>
          <h2>Calendario de atención</h2>
          <p>Reservas y bloqueos según el horario configurado.</p>
        </div>
        <span className="agenda-calendar__legend" aria-label="Leyenda">
          <i className="agenda-calendar__legend-appointment" /> Reserva
          <i className="agenda-calendar__legend-block" /> Bloqueo
        </span>
      </header>
      <div className="agenda-calendar__scroll">
        <div
          className="agenda-calendar__grid"
          style={{ "--agenda-days": Math.max(days.length, 1) }}
        >
          {days.map((day) => (
            <article className="agenda-calendar__day" key={day.date}>
              <header>
                <strong>{formatDate(day.date)}</strong>
                {day.schedule.isWorking ? (
                  <small>
                    {day.schedule.startTime}–{day.schedule.endTime}
                  </small>
                ) : (
                  <small>Sin horario</small>
                )}
              </header>
              <div className="agenda-calendar__entries">
                {day.entries.length === 0 ? (
                  <p className="agenda-calendar__empty">
                    {day.schedule.isWorking
                      ? "Sin reservas"
                      : "No disponible"}
                  </p>
                ) : (
                  day.entries.map((entry) =>
                    entry.kind === "block" ? (
                      <div className="agenda-calendar__block" key={entry.id}>
                        <Icon name="calendar" size={14} />
                        <span>
                          <strong>
                            {formatTime(entry.startAt)}–{formatTime(entry.endAt)}
                          </strong>
                          <small>{entry.reason || "Bloqueo de agenda"}</small>
                        </span>
                      </div>
                    ) : (
                      <article
                        className={`agenda-calendar__appointment agenda-calendar__appointment--${entry.status.toLowerCase()}`}
                        key={entry.id}
                      >
                        <small>
                          {formatTime(entry.startAt)}–{formatTime(entry.endAt)}
                        </small>
                        <strong>
                          {entry.patient.firstNames} {entry.patient.lastNames}
                        </strong>
                        <span>{STATUS[entry.status]}</span>
                        <div className="agenda-calendar__actions">
                          {entry.status === "CONFIRMED" && (
                            <>
                              <button
                                className="app-button app-button--primary"
                                disabled={saving}
                                onClick={() => onChangeStatus(entry, "CHECKED_IN")}
                                type="button"
                              >
                                Presente
                              </button>
                              <button
                                className="app-button app-button--soft"
                                disabled={saving}
                                onClick={() => onChangeStatus(entry, "NO_SHOW")}
                                type="button"
                              >
                                No asistió
                              </button>
                              {actor?.permissions?.includes("appointments.cancel") && (
                                <button
                                  className="app-button app-button--danger"
                                  disabled={saving}
                                  onClick={() => onChangeStatus(entry, "CANCELLED")}
                                  type="button"
                                >
                                  Cancelar
                                </button>
                              )}
                            </>
                          )}
                          {canOpenClinicalRecord(actor, entry) && (
                            <Link
                              className="app-button app-button--soft"
                              href={clinicalRecordHref(entry.id)}
                            >
                              Abrir ficha clínica
                            </Link>
                          )}
                        </div>
                      </article>
                    ),
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
