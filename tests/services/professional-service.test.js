import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  createProfessional,
  getProfessional,
  getProfessionals,
  updateProfessional,
} from "../../src/services/professional-service.js";

const actor = {
  permissions: [PERMISSIONS.SCHEDULES_MANAGE_ALL, PERMISSIONS.SCHEDULES_READ],
  userId: "00000000-0000-4000-8000-000000000001",
};
const professionalId = "00000000-0000-4000-8000-000000000002";
const professional = {
  appointmentDurationMinutes: 30,
  id: professionalId,
  isBookable: true,
  slotIntervalMinutes: 15,
};

test("crea el perfil para un usuario clínico", async () => {
  const result = await createProfessional(
    {
      appointmentDurationMinutes: 30,
      slotIntervalMinutes: 15,
      userId: professionalId,
    },
    actor,
    {
      createProfessionalProfile: async (data, actorUserId) => {
        assert.equal(data.userId, professionalId);
        assert.equal(actorUserId, actor.userId);
        return professional;
      },
    },
  );

  assert.equal(result, professional);
});

test("rechaza usuarios que no sean profesionales clínicos", async () => {
  await assert.rejects(
    () =>
      createProfessional(
        {
          appointmentDurationMinutes: 30,
          slotIntervalMinutes: 15,
          userId: professionalId,
        },
        actor,
        { createProfessionalProfile: async () => null },
      ),
    (error) => error.code === "CLINICAL_USER_NOT_FOUND" && error.status === 404,
  );
});

test("lista perfiles con permiso de lectura", async () => {
  const result = await getProfessionals(actor, {
    listProfessionalProfiles: async () => [professional],
  });

  assert.deepEqual(result, [professional]);
});

test("consulta un profesional por identificador", async () => {
  const result = await getProfessional(professionalId, actor, {
    findProfessionalById: async () => professional,
  });

  assert.equal(result, professional);
});

test("actualiza la configuración sin perder sus demás valores", async () => {
  const result = await updateProfessional(
    professionalId,
    { isBookable: false },
    actor,
    {
      findProfessionalById: async () => professional,
      updateProfessionalProfile: async (id, data, actorUserId) => {
        assert.equal(id, professionalId);
        assert.equal(actorUserId, actor.userId);
        return { ...professional, ...data };
      },
    },
  );

  assert.equal(result.isBookable, false);
});

test("impide administrar perfiles sin permiso global", async () => {
  await assert.rejects(
    () =>
      updateProfessional(professionalId, { isBookable: false }, {
        permissions: [PERMISSIONS.SCHEDULES_READ],
        userId: actor.userId,
      }),
    (error) => error.code === "INSUFFICIENT_PERMISSIONS" && error.status === 403,
  );
});
