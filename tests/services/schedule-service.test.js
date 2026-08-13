import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  createProfessionalScheduleBlock,
  getProfessionalAvailability,
  replaceProfessionalSchedule,
  setProfessionalOverride,
} from "../../src/services/schedule-service.js";

const professionalId = "00000000-0000-4000-8000-000000000001";
const actor = {
  permissions: [
    PERMISSIONS.SCHEDULES_MANAGE_OWN,
    PERMISSIONS.SCHEDULES_READ,
  ],
  userId: professionalId,
};
const professional = {
  appointmentDurationMinutes: 60,
  id: professionalId,
  isBookable: true,
  slotIntervalMinutes: 60,
};
const week = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  endTime: "18:00",
  isWorking: dayOfWeek === 1,
  startTime: "09:00",
}));

test("permite al profesional guardar su semana completa", async () => {
  const result = await replaceProfessionalSchedule(
    professionalId,
    { days: week },
    actor,
    {
      findProfessionalById: async () => professional,
      saveWeeklySchedule: async (id, days) => {
        assert.equal(id, professionalId);
        assert.equal(days.length, 7);
        return days;
      },
    },
  );

  assert.equal(result.length, 7);
});

test("permite cerrar una fecha mediante una excepción", async () => {
  const result = await setProfessionalOverride(
    professionalId,
    "2026-08-17",
    { isWorking: false },
    actor,
    {
      findProfessionalById: async () => professional,
      upsertScheduleOverride: async (id, date, override, actorUserId) => {
        assert.equal(id, professionalId);
        assert.equal(date, "2026-08-17");
        assert.equal(actorUserId, professionalId);
        return override;
      },
    },
  );

  assert.equal(result.isWorking, false);
});

test("crea un bloqueo en la agenda propia", async () => {
  const expected = { id: "00000000-0000-4000-8000-000000000003" };
  const result = await createProfessionalScheduleBlock(
    professionalId,
    {
      endAt: "2026-08-20T16:00:00.000Z",
      startAt: "2026-08-20T15:00:00.000Z",
    },
    actor,
    {
      createScheduleBlock: async () => ({ block: expected, conflict: null }),
      currentDate: new Date("2026-08-13T12:00:00.000Z"),
      findProfessionalById: async () => professional,
    },
  );

  assert.equal(result, expected);
});

test("rechaza un bloqueo que se superpone con una reserva vigente", async () => {
  await assert.rejects(
    () =>
      createProfessionalScheduleBlock(
        professionalId,
        {
          endAt: "2026-08-20T16:00:00.000Z",
          startAt: "2026-08-20T15:00:00.000Z",
        },
        actor,
        {
          createScheduleBlock: async () => ({
            block: null,
            conflict: "APPOINTMENT",
          }),
          currentDate: new Date("2026-08-13T12:00:00.000Z"),
          findProfessionalById: async () => professional,
        },
      ),
    (error) => error.code === "SCHEDULE_BLOCK_OVERLAPS_APPOINTMENT",
  );
});

test("consulta disponibilidad combinando horario, excepción y bloqueos", async () => {
  const result = await getProfessionalAvailability(
    professionalId,
    new URLSearchParams("date=2026-08-10"),
    actor,
    {
      currentDate: new Date("2026-08-01T12:00:00.000Z"),
      findProfessionalById: async () => professional,
      findScheduleOverride: async () => null,
      getBusyAppointments: async () => [],
      getScheduleBlocks: async () => [],
      getWeeklySchedule: async () => [
        {
          breakEnd: null,
          breakStart: null,
          dayOfWeek: 1,
          endTime: "11:00",
          isWorking: true,
          startTime: "09:00",
        },
      ],
      timeZone: "America/Santiago",
    },
  );

  assert.deepEqual(
    result.slots.map((slot) => slot.startAt),
    ["2026-08-10T13:00:00.000Z", "2026-08-10T14:00:00.000Z"],
  );
});

test("retira de la disponibilidad las horas que ya están reservadas", async () => {
  const result = await getProfessionalAvailability(
    professionalId,
    new URLSearchParams("date=2026-08-10"),
    actor,
    {
      currentDate: new Date("2026-08-01T12:00:00.000Z"),
      findProfessionalById: async () => professional,
      findScheduleOverride: async () => null,
      getBusyAppointments: async () => [
        {
          endAt: new Date("2026-08-10T14:00:00.000Z"),
          startAt: new Date("2026-08-10T13:00:00.000Z"),
        },
      ],
      getScheduleBlocks: async () => [],
      getWeeklySchedule: async () => [
        {
          breakEnd: null,
          breakStart: null,
          dayOfWeek: 1,
          endTime: "11:00",
          isWorking: true,
          startTime: "09:00",
        },
      ],
      timeZone: "America/Santiago",
    },
  );

  assert.deepEqual(
    result.slots.map((slot) => slot.startAt),
    ["2026-08-10T14:00:00.000Z"],
  );
});
