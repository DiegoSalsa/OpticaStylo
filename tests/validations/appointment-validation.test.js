import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAppointmentListQuery,
  validateAppointmentStatusInput,
  validatePublicBookingInput,
  validateCreateAppointmentInput,
  validateUpdateAppointmentInput,
} from "../../src/validations/appointment-validation.js";

test("valida los datos completos de una reserva pública", () => {
  const result = validatePublicBookingInput(
    {
      acceptsPrivacy: true,
      patient: {
        address: "Calle de prueba 123",
        birthDate: "1990-01-15",
        email: "PERSONA@example.com",
        firstNames: "Camila",
        lastNames: "Pérez Soto",
        phone: "+56 9 1234 5678",
        rut: "12.345.678-5",
      },
      professionalId: "00000000-0000-4000-8000-000000000003",
      startAt: "2026-08-20T09:00:00-04:00",
      website: "",
    },
    new Date("2026-08-13T12:00:00.000Z"),
  );

  assert.equal(result.patient.email, "persona@example.com");
  assert.equal(result.patient.rut, "12345678-5");
});

test("exige consentimiento para una reserva pública", () => {
  assert.throws(
    () => validatePublicBookingInput({ acceptsPrivacy: false }),
    (error) => error.code === "INVALID_APPOINTMENT_DATA",
  );
});

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
