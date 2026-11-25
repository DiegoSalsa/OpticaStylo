"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasGlobalBranchAccess, PERMISSIONS } from "@/auth/permissions";
import { useInternalActor } from "@/components/internal/internal-shell";
import { agendaContracts, readAgendaResponse } from "./agenda-api";
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
  if (!actor) return null;
  if (!actor.permissions.includes(PERMISSIONS.SCHEDULES_READ)) {
    return (
      <section className="app-card empty-module">
        <h2>Acceso no disponible</h2>
        <p>Ventas no administra agenda ni pacientes.</p>
      </section>
    );
  }
  const global = hasGlobalBranchAccess(actor);
  const branches = actor.branches ?? [];
  const branch = branches.find((item) => item.id === actor.activeBranchId)
    ?? (!global && branches.length === 1 ? branches[0] : null);
  return <BranchAgenda key={branch?.id ?? ""} actor={actor} branch={branch} global={global} />;
}

function BranchAgenda({ actor, branch, global }) {
  const branchId = branch?.id;
  const branchQuery = branchId ? new URLSearchParams({ branchId }).toString() : "";
  const canManageAll = actor.permissions.includes(PERMISSIONS.SCHEDULES_MANAGE_ALL);
  const canManageProfiles = canManageAll && global;
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(dateOnly(today));
  const [to, setTo] = useState(() => addCalendarDays(dateOnly(today), 6));
  const [calendarView, setCalendarView] = useState("week");
  const [professionals, setProfessionals] = useState([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState("");
  const [professionalsStatus, setProfessionalsStatus] = useState("loading");
  const [professionalsReload, setProfessionalsReload] = useState(0);
  const [agendaReload, setAgendaReload] = useState(0);
  const [filterStatus, setFilterStatus] = useState("");
  const [appointments, setAppointments] = useState([]);
  const [week, setWeek] = useState(defaultWeek);
  const [blocks, setBlocks] = useState([]);
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const professionalId = professionals.some((item) => item.id === selectedProfessionalId)
    ? selectedProfessionalId
    : professionals.find((item) => item.id === actor?.userId)?.id ?? professionals[0]?.id ?? "";
  const canManageSelected = Boolean(professionalId && (canManageAll || (
    actor.permissions.includes(PERMISSIONS.SCHEDULES_MANAGE_OWN) && professionalId === actor.userId
  )));
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
    if (!branchId) return;
    const controller = new AbortController();
    const { signal } = controller;
    fetch(`/api/professionals?${branchQuery}`, { cache: "no-store", signal })
      .then((response) => readAgendaResponse(response, agendaContracts.professionals))
      .then((items) => {
        if (signal.aborted) return;
        setProfessionals(canManageAll ? items : items.filter((item) => item.id === actor.userId));
        setProfessionalsStatus("ready");
      })
      .catch((error) => {
        if (signal.aborted) return;
        setProfessionalsStatus("error");
        setNotice({ kind: "error", text: error.message });
      });
    return () => controller.abort();
  }, [actor.userId, branchId, branchQuery, canManageAll, professionalsReload]);

  const loadAppointments = useCallback(
    async (signal) => {
      const params = new URLSearchParams({ ...range, branchId });
      if (professionalId) params.set("professionalId", professionalId);
      if (filterStatus) params.set("status", filterStatus);
      return readAgendaResponse(
        await fetch(`/api/appointments?${params}`, { cache: "no-store", signal }),
        agendaContracts.appointments,
      );
    },
    [branchId, filterStatus, professionalId, range],
  );

  const loadSchedule = useCallback(
    async (signal) => {
      const url = `/api/professionals/${professionalId}/schedule`;
      const params = new URLSearchParams({ ...range, branchId });
      const [schedule, scheduleBlocks] = await Promise.all([
        fetch(`${url}?${branchQuery}`, { cache: "no-store", signal })
          .then((response) => readAgendaResponse(response, agendaContracts.schedule)),
        fetch(`${url}/blocks?${params}`, { cache: "no-store", signal })
          .then((response) => readAgendaResponse(response, agendaContracts.blocks)),
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
    [branchId, branchQuery, professionalId, range],
  );

  useEffect(() => {
    if (!branchId || professionalsStatus !== "ready" || !professionalId) return;
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([loadAppointments(signal), loadSchedule(signal)])
      .then(([appointmentItems, schedule]) => {
        if (signal.aborted) return;
        setAppointments(appointmentItems);
        setWeek(schedule.week);
        setBlocks(schedule.blocks);
        setStatus("ready");
      })
      .catch((error) => {
        if (signal.aborted) return;
        controller.abort();
        setNotice({ kind: "error", text: error.message });
        setStatus("error");
      });
    return () => controller.abort();
  }, [branchId, agendaReload, loadAppointments, loadSchedule, professionalId, professionalsStatus]);

  function startLoading() {
    setStatus("loading");
    setNotice(null);
  }

  function reloadProfessionals() {
    if (!branchId) return;
    startLoading();
    setProfessionalsStatus("loading");
    setProfessionalsReload((revision) => revision + 1);
  }

  function refresh() {
    if (professionalsStatus !== "ready" || !professionalId) {
      reloadProfessionals();
      return;
    }
    startLoading();
    setAgendaReload((revision) => revision + 1);
  }
  async function changeAppointment(appointment, nextStatus) {
    let cancellationReason;
    if (nextStatus === "CANCELLED") {
      cancellationReason = window.prompt("Motivo obligatorio de cancelación:");
      if (!cancellationReason) return;
    }
    setStatus("saving");
    try {
      const saved = await readAgendaResponse(
        await fetch(`/api/appointments/${appointment.id}/status`, {
          body: JSON.stringify({ branchId, cancellationReason, status: nextStatus }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
        agendaContracts.appointment,
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
  function selectProfessional(value) {
    startLoading();
    setSelectedProfessionalId(value);
  }

  function updateCalendarStart(nextFrom) {
    if (!nextFrom || nextFrom === from) return;
    startLoading();
    setFrom(nextFrom);
    setTo(addCalendarDays(nextFrom, calendarView === "day" ? 0 : 6));
  }
  function updateCalendarEnd(nextTo) {
    if (!nextTo || nextTo === to) return;
    startLoading();
    setTo(nextTo);
  }

  function changeFilterStatus(value) {
    startLoading();
    setFilterStatus(value);
  }

  function changeCalendarView(nextView) {
    if (nextView === calendarView) return;
    const nextTo = addCalendarDays(from, nextView === "day" ? 0 : 6);
    if (nextTo !== to) startLoading();
    setCalendarView(nextView);
    setTo(nextTo);
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
      const saved = await readAgendaResponse(
        await fetch(`/api/professionals/${professionalId}/schedule`, {
          body: JSON.stringify({ branchId, days: week }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        }),
        agendaContracts.schedule,
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setStatus("saving");
    try {
      const saved = await readAgendaResponse(
        await fetch(`/api/professionals/${professionalId}/schedule/blocks`, {
          body: JSON.stringify({
            branchId,
            endAt: new Date(form.get("endAt")).toISOString(),
            reason: form.get("reason") || null,
            startAt: new Date(form.get("startAt")).toISOString(),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        agendaContracts.block,
      );
      setBlocks((items) =>
        [...items, saved].sort(
          (a, b) => new Date(a.startAt) - new Date(b.startAt),
        ),
      );
      formElement.reset();
      setNotice({ kind: "success", text: "Bloqueo agregado a la agenda." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setStatus("ready");
    }
  }
  // Eliminar o cancelar remove block de forma controlada y consistente
  async function removeBlock(block) {
    if (!window.confirm("¿Eliminar este bloqueo de agenda?")) return;
    setStatus("saving");
    try {
      const response = await fetch(
        `/api/professionals/${professionalId}/schedule/blocks/${block.id}?${branchQuery}`,
        { method: "DELETE" },
      );
      if (!response.ok) await readAgendaResponse(response, agendaContracts.block);
      setBlocks((items) => items.filter((item) => item.id !== block.id));
      setNotice({ kind: "success", text: "Bloqueo retirado." });
    } catch (error) {
      setNotice({ kind: "error", text: error.message });
    } finally {
      setStatus("ready");
    }
  }

  const viewStatus = !branchId ? "needs-branch" : professionalsStatus !== "ready"
    ? professionalsStatus
    : professionalId ? status : "empty";
  const hasAgenda = viewStatus === "ready" || viewStatus === "saving";

  return (
    <AgendaInterface
      model={{
        DAYS,
        STATUS,
        actor,
        appointments,
        blocks: hasAgenda ? blocks : [],
        branch,
        calendarDays,
        calendarView,
        canManageAll,
        canManageProfiles,
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
        setFilterStatus: changeFilterStatus,
        setProfessionalId: selectProfessional,
        reloadProfessionals,
        setTo: updateCalendarEnd,
        status: viewStatus,
        to,
        updateCalendarStart,
        updateDay,
        week: hasAgenda ? week : defaultWeek(),
      }}
    />
  );
}
