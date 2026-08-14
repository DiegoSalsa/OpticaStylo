import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  changeAppointmentStatus,
  createAppointment,
  getAppointment,
  getAppointmentHistory,
  getAppointmentList,
  updateAppointment,
} from "../../src/services/appointment-service.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const patientId = "00000000-0000-4000-8000-000000000002";
const professionalId = "00000000-0000-4000-8000-000000000003";
const appointmentId = "00000000-0000-4000-8000-000000000004";
const otherProfessionalId = "00000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-13T12:00:00.000Z");
const admin = {
  permissions: [
    PERMISSIONS.APPOINTMENTS_CANCEL,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_READ_ALL,
    PERMISSIONS.APPOINTMENTS_UPDATE,
  ],
  userId: actorId,
};
const professionalActor = {
  permissions: [
    PERMISSIONS.APPOINTMENTS_READ_OWN,
    PERMISSIONS.APPOINTMENTS_UPDATE_OWN_STATUS,
  ],
  userId: professionalId,
};

function buildAppointment(overrides = {}) {
  return {
    id: appointmentId,
    professional: { id: professionalId },
    status: "CONFIRMED",
    ...overrides,
  };
}

test("crea una reserva usando la duración del cupo disponible", async () => {
  const expected = buildAppointment();
  const result = await createAppointment(
    {
      patientId,
      professionalId,
      startAt: "2026-08-20T09:00:00-04:00",
    },
    admin,
    {
      createAppointment: async (data, userId) => {
        assert.equal(data.startAt.toISOString(), "2026-08-20T13:00:00.000Z");
        assert.equal(data.endAt.toISOString(), "2026-08-20T14:00:00.000Z");
        assert.equal(userId, actorId);
        return { appointment: expected, conflict: null };
      },
      currentDate: now,
      findPatientById: async () => ({ id: patientId }),
      findProfessionalById: async () => ({ id: professionalId }),
      getProfessionalAvailability: async (id, searchParams) => {
        assert.equal(id, professionalId);
        assert.equal(searchParams.get("date"), "2026-08-20");
        return {
          slots: [
            {
              endAt: "2026-08-20T14:00:00.000Z",
              startAt: "2026-08-20T13:00:00.000Z",
            },
          ],
        };
      },
      timeZone: "America/Santiago",
    },
  );

  assert.equal(result, expected);
});

test("rechaza una hora que dejó de estar disponible", async () => {
  await assert.rejects(
    () =>
      createAppointment(
        {
          patientId,
          professionalId,
          startAt: "2026-08-20T09:00:00-04:00",
        },
        admin,
        {
          currentDate: now,
          findPatientById: async () => ({ id: patientId }),
          findProfessionalById: async () => ({ id: professionalId }),
          getProfessionalAvailability: async () => ({ slots: [] }),
          timeZone: "America/Santiago",
        },
      ),
    (error) => error.code === "APPOINTMENT_TIME_NOT_AVAILABLE",
  );
});

test("fuerza al profesional a listar únicamente sus reservas", async () => {
  const result = await getAppointmentList(
    new URLSearchParams({
      from: "2026-08-01T00:00:00-04:00",
      to: "2026-09-01T00:00:00-04:00",
    }),
    professionalActor,
    {
      listAppointments: async (query) => {
        assert.equal(query.ownProfessionalId, professionalId);
        return [buildAppointment()];
      },
    },
  );

  assert.equal(result.length, 1);
});

test("oculta una reserva ajena al profesional", async () => {
  await assert.rejects(
    () =>
      getAppointment(appointmentId, professionalActor, {
        findAppointmentById: async () =>
          buildAppointment({ professional: { id: otherProfessionalId } }),
      }),
    (error) => error.code === "APPOINTMENT_NOT_FOUND",
  );
});

test("reagenda una reserva confirmada y excluye la reserva actual", async () => {
  const expected = buildAppointment();
  const result = await updateAppointment(
    appointmentId,
    { startAt: "2026-08-20T10:00:00-04:00" },
    admin,
    {
      currentDate: now,
      findAppointmentById: async () => buildAppointment(),
      getProfessionalAvailability: async (id, searchParams, actor, options) => {
        assert.equal(options.excludedAppointmentId, appointmentId);
        return {
          slots: [
            {
              endAt: "2026-08-20T15:00:00.000Z",
              startAt: "2026-08-20T14:00:00.000Z",
            },
          ],
        };
      },
      timeZone: "America/Santiago",
      updateAppointment: async (id, changes) => {
        assert.equal(changes.endAt.toISOString(), "2026-08-20T15:00:00.000Z");
        return { appointment: expected, conflict: null, currentStatus: "CONFIRMED" };
      },
    },
  );

  assert.equal(result, expected);
});

test("permite al profesional marcar como atendida su propia reserva", async () => {
  const expected = buildAppointment({ status: "CHECKED_IN" });
  const result = await changeAppointmentStatus(
    appointmentId,
    { status: "CHECKED_IN" },
    professionalActor,
    {
      changeAppointmentStatus: async (id, allowedStatuses, data) => {
        assert.deepEqual(allowedStatuses, ["CONFIRMED"]);
        assert.equal(data.status, "CHECKED_IN");
        return { appointment: expected, currentStatus: "CONFIRMED" };
      },
      currentDate: now,
      findAppointmentById: async () => buildAppointment(),
    },
  );

  assert.equal(result.status, "CHECKED_IN");
});

test("impide saltar desde confirmada directamente a completada", async () => {
  await assert.rejects(
    () =>
      changeAppointmentStatus(
        appointmentId,
        { status: "COMPLETED" },
        admin,
        { findAppointmentById: async () => buildAppointment() },
      ),
    (error) =>
      error.code === "APPOINTMENT_COMPLETION_REQUIRES_FINALIZED_ENCOUNTER",
  );
});

test("reserva la finalización para el flujo clínico", async () => {
  await assert.rejects(
    () =>
      changeAppointmentStatus(
        appointmentId,
        { status: "COMPLETED" },
        professionalActor,
        {
          findAppointmentById: async () =>
            buildAppointment({ status: "CHECKED_IN" }),
        },
      ),
    (error) =>
      error.code === "APPOINTMENT_COMPLETION_REQUIRES_FINALIZED_ENCOUNTER",
  );
});

test("entrega el historial a quien puede leer la reserva", async () => {
  const result = await getAppointmentHistory(appointmentId, admin, {
    findAppointmentById: async () => buildAppointment(),
    getAppointmentHistory: async () => [{ eventType: "CREATED" }],
  });

  assert.equal(result.appointmentId, appointmentId);
  assert.equal(result.events[0].eventType, "CREATED");
});
