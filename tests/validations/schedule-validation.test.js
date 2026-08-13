import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreateScheduleBlockInput,
  validateScheduleOverrideInput,
  validateWeeklyScheduleInput,
} from "../../src/validations/schedule-validation.js";

function createWeek() {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    breakEnd: dayOfWeek === 1 ? "14:00" : null,
    breakStart: dayOfWeek === 1 ? "13:00" : null,
    dayOfWeek,
    endTime: "18:00",
    isWorking: dayOfWeek >= 1 && dayOfWeek <= 5,
    startTime: "09:00",
  }));
}

test("valida una semana completa sin días repetidos", () => {
  const result = validateWeeklyScheduleInput({ days: createWeek() });

  assert.equal(result.length, 7);
  assert.equal(result[1].breakStart, "13:00");
});

test("rechaza semanas incompletas", () => {
  assert.throws(
    () => validateWeeklyScheduleInput({ days: createWeek().slice(0, 6) }),
    /exactamente siete días/,
  );
});

test("rechaza pausas fuera del horario laboral", () => {
  const days = createWeek();
  days[1].breakStart = "17:30";
  days[1].breakEnd = "18:30";

  assert.throws(
    () => validateWeeklyScheduleInput({ days }),
    /dentro del horario de trabajo/,
  );
});

test("normaliza una excepción de día cerrado", () => {
  assert.deepEqual(validateScheduleOverrideInput({ isWorking: false }), {
    breakEnd: null,
    breakStart: null,
    endTime: null,
    isWorking: false,
    startTime: null,
  });
});

test("valida bloqueos que terminan en el futuro", () => {
  const result = validateCreateScheduleBlockInput(
    {
      endAt: "2026-08-20T16:00:00.000Z",
      reason: "  Reunión   clínica ",
      startAt: "2026-08-20T15:00:00.000Z",
    },
    new Date("2026-08-13T12:00:00.000Z"),
  );

  assert.equal(result.reason, "Reunión clínica");
});
