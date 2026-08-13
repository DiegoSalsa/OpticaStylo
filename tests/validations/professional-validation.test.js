import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreateProfessionalInput,
  validateUpdateProfessionalInput,
} from "../../src/validations/professional-validation.js";

const userId = "00000000-0000-4000-8000-000000000001";

test("valida la configuración de un profesional", () => {
  assert.deepEqual(
    validateCreateProfessionalInput({
      appointmentDurationMinutes: 30,
      slotIntervalMinutes: 15,
      userId,
    }),
    {
      appointmentDurationMinutes: 30,
      isBookable: true,
      slotIntervalMinutes: 15,
      userId,
    },
  );
});

test("rechaza duraciones e intervalos fuera de rango", () => {
  assert.throws(
    () =>
      validateCreateProfessionalInput({
        appointmentDurationMinutes: 4,
        slotIntervalMinutes: 15,
        userId,
      }),
    /entre 5 y 480/,
  );
  assert.throws(
    () =>
      validateCreateProfessionalInput({
        appointmentDurationMinutes: 30,
        slotIntervalMinutes: 121,
        userId,
      }),
    /entre 5 y 120/,
  );
});

test("completa una actualización con la configuración existente", () => {
  assert.deepEqual(
    validateUpdateProfessionalInput(
      { isBookable: false },
      {
        appointmentDurationMinutes: 30,
        isBookable: true,
        slotIntervalMinutes: 15,
      },
    ),
    {
      appointmentDurationMinutes: 30,
      isBookable: false,
      slotIntervalMinutes: 15,
    },
  );
});
