import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  buildAgendaDays,
  canOpenClinicalRecord,
  clinicalRecordHref,
} from "../../src/app/app/agenda/agenda-calendar-model.js";

const appointment = {
  endAt: "2026-08-25T14:30:00.000Z",
  id: "reserva presente/1",
  startAt: "2026-08-25T14:00:00.000Z",
  status: "CHECKED_IN",
};

test("organiza reservas y bloqueos por día y hora para la vista semanal", () => {
  const [monday, tuesday] = buildAgendaDays({
    appointments: [appointment],
    blocks: [
      {
        endAt: "2026-08-25T13:30:00.000Z",
        id: "bloqueo-1",
        startAt: "2026-08-25T13:00:00.000Z",
      },
    ],
    from: "2026-08-24",
    schedule: [
      {
        dayOfWeek: 2,
        endTime: "18:00",
        isWorking: true,
        startTime: "09:00",
      },
    ],
    to: "2026-08-25",
  });

  assert.equal(monday.schedule.isWorking, false);
  assert.equal(tuesday.schedule.isWorking, true);
  assert.deepEqual(
    tuesday.entries.map((entry) => [entry.kind, entry.id]),
    [
      ["block", "bloqueo-1"],
      ["appointment", "reserva presente/1"],
    ],
  );
  assert.equal(addCalendarDays("2026-08-30", 1), "2026-08-31");
});

test("la navegación agenda → ficha conserva la reserva y exige un rol clínico", () => {
  const clinicalActor = {
    permissions: ["medical_records.read_assigned"],
  };

  assert.equal(canOpenClinicalRecord(clinicalActor, appointment), true);
  assert.equal(
    canOpenClinicalRecord({ permissions: ["schedules.read"] }, appointment),
    false,
  );
  assert.equal(
    canOpenClinicalRecord(clinicalActor, { ...appointment, status: "CONFIRMED" }),
    false,
  );
  assert.equal(
    clinicalRecordHref(appointment.id),
    "/app/ficha-clinica?appointmentId=reserva%20presente%2F1",
  );
});
