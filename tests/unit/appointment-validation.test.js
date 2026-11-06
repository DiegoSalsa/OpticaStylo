import assert from "node:assert/strict";
import test from "node:test";

import { validateAppointmentStatusInput } from "../../src/validations/appointment-validation.js";

test("exige motivo para cancelar", () => {
  assert.throws(
    () => validateAppointmentStatusInput({ status: "CANCELLED" }),
    /motivo de cancelación/,
  );
});
