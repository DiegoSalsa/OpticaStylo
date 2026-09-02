"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readResponse,
  useInternalActor,
} from "@/components/internal/internal-shell";
import { addCalendarDays, buildAgendaDays } from "./agenda-calendar-model";
import AgendaInterface from "./agenda-interface";
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
  const [to, setTo] = useState(() => addCalendarDays(dateOnly(today), 6));
  const [calendarView, setCalendarView] = useState("week");
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
  const calendarDays = useMemo(
    () =>
      buildAgendaDays({
        appointments,
        blocks,
        from,
        schedule: week,
        to,
      }),
    [appointments, blocks, from, to, week],
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
  function updateCalendarStart(nextFrom) {
    setFrom(nextFrom);
    setTo(addCalendarDays(nextFrom, calendarView === "day" ? 0 : 6));
  }
  function changeCalendarView(nextView) {
    setCalendarView(nextView);
    setTo(addCalendarDays(from, nextView === "day" ? 0 : 6));
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
    <AgendaInterface
      model={{
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
      }}
    />
  );
}
