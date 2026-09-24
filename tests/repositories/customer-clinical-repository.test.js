import assert from "node:assert/strict";
import test from "node:test";

import {
  mapCustomerClinicalAppointment,
  mapCustomerClinicalPrescription,
} from "../../src/repositories/customer-clinical-repository.js";

test("proyecta reservas sin notas ni eventos internos", () => {
  const result = mapCustomerClinicalAppointment({
    end_at: new Date("2026-10-01T16:00:00.000Z"),
    id: "appointment-internal",
    internal_notes: "dato privado",
    appointment_events: [{ details: "historial privado" }],
    professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Ana", last_name: "Rojas" } },
    start_at: new Date("2026-10-01T15:00:00.000Z"),
    status: "CONFIRMED",
  });
  assert.deepEqual(result, {
    endAt: new Date("2026-10-01T16:00:00.000Z"),
    professional: { firstName: "Ana", lastName: "Rojas" },
    startAt: new Date("2026-10-01T15:00:00.000Z"),
    status: "CONFIRMED",
  });
  assert.equal(result.internalNotes, undefined);
  assert.equal(result.appointmentEvents, undefined);
});

test("proyecta recetas de atención finalizada sin ficha clínica y distingue reemplazos", () => {
  const result = mapCustomerClinicalPrescription({
    anamnesis: "dato privado",
    diagnosis: "dato privado",
    fulfillment_notes: "Preparar en cristal orgánico",
    issued_at: new Date("2026-09-01T12:00:00.000Z"),
    left_addition: "1.00", left_axis: 90, left_cylinder: "-0.50", left_sphere: "-1.25",
    other_optical_prescriptions: [{ status: "VOIDED" }],
    professional_profiles: { users_professional_profiles_user_idTousers: { first_name: "Luis", last_name: "Pérez" } },
    pupillary_distance: "62.00",
    right_addition: "1.00", right_axis: 90, right_cylinder: "-0.50", right_sphere: "-1.00",
    status: "VOIDED",
  });
  assert.equal(result.status, "REPLACED");
  assert.equal(result.fulfillmentNotes, "Preparar en cristal orgánico");
  assert.equal(result.anamnesis, undefined);
  assert.equal(result.diagnosis, undefined);
  assert.equal(result.professional.firstName, "Luis");
});
