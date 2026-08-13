import assert from "node:assert/strict";
import test from "node:test";

import { buildAvailabilitySlots } from "../../src/services/availability-engine.js";

const baseInput = {
  appointmentDurationMinutes: 60,
  date: "2026-08-10",
  isBookable: true,
  now: new Date("2026-08-01T12:00:00.000Z"),
  slotIntervalMinutes: 60,
  timeZone: "America/Santiago",
  weeklySchedule: [
    {
      breakEnd: "11:00",
      breakStart: "10:00",
      dayOfWeek: 1,
      endTime: "13:00",
      isWorking: true,
      startTime: "09:00",
    },
  ],
};

test("genera cupos en UTC respetando el horario local y la pausa", () => {
  const slots = buildAvailabilitySlots(baseInput);

  assert.deepEqual(
    slots.map((slot) => slot.startAt),
    [
      "2026-08-10T13:00:00.000Z",
      "2026-08-10T15:00:00.000Z",
      "2026-08-10T16:00:00.000Z",
    ],
  );
});

test("elimina cupos que se superponen con un bloqueo", () => {
  const slots = buildAvailabilitySlots({
    ...baseInput,
    blocks: [
      {
        endAt: "2026-08-10T16:00:00.000Z",
        startAt: "2026-08-10T15:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    slots.map((slot) => slot.startAt),
    ["2026-08-10T13:00:00.000Z", "2026-08-10T16:00:00.000Z"],
  );
});

test("una excepción cerrada prevalece sobre la semana habitual", () => {
  assert.deepEqual(
    buildAvailabilitySlots({
      ...baseInput,
      override: { isWorking: false },
    }),
    [],
  );
});

test("no ofrece horas pasadas ni perfiles no reservables", () => {
  assert.deepEqual(
    buildAvailabilitySlots({
      ...baseInput,
      now: new Date("2026-08-10T15:30:00.000Z"),
    }).map((slot) => slot.startAt),
    ["2026-08-10T16:00:00.000Z"],
  );
  assert.deepEqual(buildAvailabilitySlots({ ...baseInput, isBookable: false }), []);
});
