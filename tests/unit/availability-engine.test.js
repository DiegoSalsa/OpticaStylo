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

test("una excepción cerrada prevalece sobre la semana habitual", () => {
  assert.deepEqual(
    buildAvailabilitySlots({
      ...baseInput,
      override: { isWorking: false },
    }),
    [],
  );
});
