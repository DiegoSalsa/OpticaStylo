import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicBooking,
  getPublicAvailability,
  getPublicProfessionals,
} from "../../src/services/public-booking-service.js";

const professionalId = "00000000-0000-4000-8000-000000000003";
const appointmentId = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-08-13T12:00:00.000Z");

function input() {
  return {
    acceptsPrivacy: true,
    patient: {
      address: "Calle de prueba 123",
      birthDate: "1990-01-15",
      email: "persona@example.com",
      firstNames: "Camila",
      lastNames: "Pérez Soto",
      phone: "+56912345678",
      rut: "12.345.678-5",
    },
    professionalId,
    startAt: "2026-08-20T09:00:00-04:00",
    website: "",
  };
}

test("publica solamente profesionales que aceptan reservas", async () => {
  const result = await getPublicProfessionals({
    listProfessionalProfiles: async () => [
      { appointmentDurationMinutes: 45, email: "privado@example.com", firstName: "Ana", id: professionalId, isBookable: true, lastName: "Rojas" },
      { appointmentDurationMinutes: 30, firstName: "No", id: appointmentId, isBookable: false, lastName: "Disponible" },
    ],
  });

  assert.deepEqual(result, [{ appointmentDurationMinutes: 45, firstName: "Ana", id: professionalId, lastName: "Rojas" }]);
  assert.equal(Object.hasOwn(result[0], "email"), false);
});

test("consulta disponibilidad pública con un actor de solo lectura", async () => {
  const result = await getPublicAvailability(
    professionalId,
    new URLSearchParams({ date: "2026-08-20" }),
    {
      getProfessionalAvailability: async (id, search, actor) => {
        assert.equal(id, professionalId);
        assert.equal(search.get("date"), "2026-08-20");
        assert.ok(actor.permissions.includes("schedules.read"));
        return { slots: [] };
      },
    },
  );
  assert.deepEqual(result.slots, []);
});

test("crea una reserva pública sin exponer datos clínicos", async () => {
  const result = await createPublicBooking(input(), {
    createManageToken: () => "token-publico",
    createPublicBooking: async (data) => {
      assert.equal(data.patient.rut, "12345678-5");
      assert.equal(data.manageTokenHash, "hash-token");
      assert.equal(data.endAt.toISOString(), "2026-08-20T14:00:00.000Z");
      return {
        appointment: {
          endAt: data.endAt,
          id: appointmentId,
          patient: { id: "privado" },
          professional: { firstName: "Ana", id: professionalId, lastName: "Rojas" },
          startAt: data.startAt,
          status: "CONFIRMED",
        },
        conflict: null,
      };
    },
    currentDate: now,
    findProfessionalById: async () => ({ id: professionalId, isBookable: true }),
    getProfessionalAvailability: async () => ({
      slots: [{ endAt: "2026-08-20T14:00:00.000Z", startAt: "2026-08-20T13:00:00.000Z" }],
    }),
    hashManageToken: (token) => token === "token-publico" ? "hash-token" : "incorrecto",
    timeZone: "America/Santiago",
  });

  assert.equal(result.manageToken, "token-publico");
  assert.equal(result.appointment.id, appointmentId);
  assert.equal(Object.hasOwn(result.appointment, "patient"), false);
});

test("rechaza una hora pública que dejó de estar disponible", async () => {
  await assert.rejects(
    () => createPublicBooking(input(), {
      currentDate: now,
      findProfessionalById: async () => ({ id: professionalId, isBookable: true }),
      getProfessionalAvailability: async () => ({ slots: [] }),
      timeZone: "America/Santiago",
    }),
    (error) => error.code === "PUBLIC_BOOKING_TIME_NOT_AVAILABLE",
  );
});

test("no revela un paciente existente cuando la identidad no coincide", async () => {
  await assert.rejects(
    () => createPublicBooking(input(), {
      createManageToken: () => "token-publico",
      createPublicBooking: async () => ({ appointment: null, conflict: "IDENTITY" }),
      currentDate: now,
      findProfessionalById: async () => ({ id: professionalId, isBookable: true }),
      getProfessionalAvailability: async () => ({ slots: [{ endAt: "2026-08-20T14:00:00.000Z", startAt: "2026-08-20T13:00:00.000Z" }] }),
      hashManageToken: () => "hash-token",
      timeZone: "America/Santiago",
    }),
    (error) => error.code === "PUBLIC_BOOKING_IDENTITY_NOT_VERIFIED" && error.status === 409,
  );
});
