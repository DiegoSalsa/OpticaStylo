"use client";

import Link from "next/link";

import Icon from "@/components/ui/icon";
import AgendaCalendar from "./agenda-calendar";
import InternalBooking from "./internal-booking";
import ProfessionalManager from "./professional-manager";

export default function AgendaInterface({ model }) {
  const {
    DAYS,
    STATUS,
    actor,
    appointments,
    blocks,
    calendarDays,
    calendarView,
    canManageAll,
    canManageSelected,
    changeAppointment,
    changeCalendarView,
    createBlock,
    filterStatus,
    from,
    notice,
    professionalId,
    professionals,
    refresh,
    removeBlock,
    saveWeek,
    setFilterStatus,
    setProfessionalId,
    setProfessionals,
    setTo,
    status,
    to,
    updateCalendarStart,
    updateDay,
    week,
  } = model;

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
      <nav className="agenda-tabs" aria-label="Vistas de agenda">
        <a href="#agenda-operativa">
          <Icon name="calendar" size={16} /> Agenda
        </a>
        <a href="#configuracion-profesionales">
          <Icon name="settings" size={16} /> Configuración de profesionales
        </a>
      </nav>
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
          <span>{calendarView === "day" ? "Fecha" : "Desde"}</span>
          <input
            onChange={(event) => updateCalendarStart(event.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className="field agenda-view-control">
          <span>Vista</span>
          <select
            aria-label="Vista de calendario"
            onChange={(event) => changeCalendarView(event.target.value)}
            value={calendarView}
          >
            <option value="day">Diaria</option>
            <option value="week">Semanal</option>
          </select>
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
        <div className="agenda-calendar-area">
          {status === "loading" ? (
            <section className="app-card agenda-list">
              <p className="directory-state">Cargando agenda…</p>
            </section>
          ) : (
            <AgendaCalendar
              actor={actor}
              days={calendarDays}
              onChangeStatus={changeAppointment}
              saving={status === "saving"}
            />
          )}
          <section className="app-card agenda-list agenda-list--details">
            <h2>Detalle de reservas</h2>
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
                          {actor?.permissions.includes(
                            "appointments.cancel",
                          ) && (
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
        </div>
        <aside className="schedule-panel" id="configuracion-profesionales">
          <form className="app-card schedule-card" onSubmit={saveWeek}>
            <h2>Horario semanal</h2>
            <p>Configura únicamente horarios confirmados por la óptica.</p>
            <div className="week-grid">
              {week.map((day, index) => (
                <div className="week-day" key={day.dayOfWeek}>
                  <label className="week-day-heading">
                    <input
                      aria-label={`${DAYS[day.dayOfWeek]} trabaja`}
                      checked={day.isWorking}
                      disabled={!canManageSelected}
                      onChange={(event) =>
                        updateDay(index, "isWorking", event.target.checked)
                      }
                      type="checkbox"
                    />
                    <strong>{DAYS[day.dayOfWeek]}</strong>
                  </label>
                  <div className="week-time-grid">
                    {[
                      ["startTime", "Inicio", "09:00"],
                      ["endTime", "Término", "18:00"],
                      ["breakStart", "Inicio pausa", ""],
                      ["breakEnd", "Fin pausa", ""],
                    ].map(([field, label, fallback]) => (
                      <label key={field}>
                        <span>{label}</span>
                        <input
                          aria-label={`${DAYS[day.dayOfWeek]} ${label.toLowerCase()}`}
                          disabled={!canManageSelected || !day.isWorking}
                          onChange={(event) =>
                            updateDay(index, field, event.target.value)
                          }
                          type="time"
                          value={day[field] ?? fallback}
                        />
                      </label>
                    ))}
                  </div>
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
      {canManageAll && (
        <div className="professional-config-panel">
          <ProfessionalManager
            onChanged={setProfessionals}
            professionals={professionals}
          />
        </div>
      )}
    </>
  );
}
