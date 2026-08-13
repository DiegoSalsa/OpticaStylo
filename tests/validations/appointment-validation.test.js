import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAppointmentListQuery,
  validateAppointmentStatusInput,
  validateCreateAppointmentInput,
  validateUpdateAppointmentInput,
} from "../../src/validations/appointment-validation.js";

const patientId = "00000000-0000-4000-8000-000000000001";
const professionalId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-13T12:00:00.000Z");

test("normaliza los datos de una reserva futura", () => {
  const result = validateCreateAppointmentInput(
    {
      internalNotes: "  Control   anual ",
      patientId,
      professionalId,
      startAt: "2026-08-20T10:00:00-04:00",
    },
    now,
  );

  assert.equal(result.internalNotes, "Control anual");
  assert.equal(result.startAt.toISOString(), "2026-08-20T14:00:00.000Z");
});

test("rechaza una hora sin zona horaria explícita", () => {
  assert.throws(
    () =>
      validateCreateAppointmentInput(
        {
          patientId,
          professionalId,
          startAt: "2026-08-20T10:00:00",
        },
        now,
      ),
    /zona horaria/,
  );
});

test("permite limpiar las notas internas", () => {
  assert.deepEqual(validateUpdateAppointmentInput({ internalNotes: "" }, now), {
    internalNotes: null,
    startAt: undefined,
  });
});

test("exige motivo para cancelar", () => {
  assert.throws(
    () => validateAppointmentStatusInput({ status: "CANCELLED" }),
    /motivo de cancelación/,
  );
});

test("valida filtros de agenda de hasta un año", () => {
  const result = validateAppointmentListQuery(
    new URLSearchParams({
      from: "2026-08-01T00:00:00-04:00",
      professionalId,
      status: "CONFIRMED",
      to: "2026-09-01T00:00:00-04:00",
    }),
  );

  assert.equal(result.professionalId, professionalId);
  assert.equal(result.status, "CONFIRMED");
});
