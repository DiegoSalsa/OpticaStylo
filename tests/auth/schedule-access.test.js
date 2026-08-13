import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import { requireScheduleManagement } from "../../src/auth/schedule-access.js";

const professionalId = "00000000-0000-4000-8000-000000000001";

test("permite al administrador gestionar cualquier agenda", () => {
  assert.doesNotThrow(() =>
    requireScheduleManagement(
      {
        permissions: [PERMISSIONS.SCHEDULES_MANAGE_ALL],
        userId: "00000000-0000-4000-8000-000000000002",
      },
      professionalId,
    ),
  );
});

test("permite al profesional gestionar su propia agenda", () => {
  assert.doesNotThrow(() =>
    requireScheduleManagement(
      {
        permissions: [PERMISSIONS.SCHEDULES_MANAGE_OWN],
        userId: professionalId,
      },
      professionalId,
    ),
  );
});

test("impide al profesional modificar una agenda ajena", () => {
  assert.throws(
    () =>
      requireScheduleManagement(
        {
          permissions: [PERMISSIONS.SCHEDULES_MANAGE_OWN],
          userId: "00000000-0000-4000-8000-000000000002",
        },
        professionalId,
      ),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS" && error.status === 403,
  );
});
