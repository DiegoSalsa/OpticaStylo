import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS } from "../../src/auth/permissions.js";
import {
  createPrescription,
  getPrescription,
  getPrescriptionList,
  updatePrescription,
} from "../../src/services/prescription-service.js";

const professionalId = "00000000-0000-4000-8000-000000000001";
const patientId = "00000000-0000-4000-8000-000000000002";
const encounterId = "00000000-0000-4000-8000-000000000003";
const prescriptionId = "00000000-0000-4000-8000-000000000004";
const clinicalActor = {
  permissions: [
    PERMISSIONS.PRESCRIPTIONS_CREATE,
    PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED,
  ],
  userId: professionalId,
};
const salesActor = {
  permissions: [PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE],
  userId: "00000000-0000-4000-8000-000000000005",
};
const prescriptionInput = {
  leftEye: { axis: 90, cylinder: -0.5, sphere: 1.25 },
  pupillaryDistance: 62,
  rightEye: { cylinder: 0, sphere: 1 },
};

function buildPrescription(overrides = {}) {
  return {
    encounterId,
    encounterStatus: "FINALIZED",
    fulfillmentNotes: "Uso permanente",
    id: prescriptionId,
    issuedAt: new Date("2026-08-14T15:00:00.000Z"),
    issuedBy: { id: professionalId },
    leftEye: prescriptionInput.leftEye,
    patient: { id: patientId },
    professionalId,
    pupillaryDistance: 62,
    replacementReason: null,
    rightEye: prescriptionInput.rightEye,
    status: "ACTIVE",
    version: 1,
    ...overrides,
  };
}

test("emite una receta para la atención propia", async () => {
  const expected = buildPrescription({ encounterStatus: "DRAFT" });
  const result = await createPrescription(
    encounterId,
    prescriptionInput,
    clinicalActor,
    {
      createOrReplacePrescription: async (id, data, userId) => {
        assert.equal(id, encounterId);
        assert.equal(data.leftEye.axis, 90);
        assert.equal(userId, professionalId);
        return { prescription: expected, reason: null };
      },
    },
  );

  assert.equal(result.id, prescriptionId);
  assert.equal(Object.hasOwn(result, "professionalId"), false);
});

test("exige justificar el reemplazo de una receta emitida", async () => {
  await assert.rejects(
    () =>
      createPrescription(encounterId, prescriptionInput, clinicalActor, {
        createOrReplacePrescription: async () => ({
          prescription: null,
          reason: "REPLACEMENT_REASON_REQUIRED",
        }),
      }),
    (error) => error.code === "PRESCRIPTION_REPLACEMENT_REASON_REQUIRED",
  );
});

test("actualiza una receta mientras la atención sigue en borrador", async () => {
  const expected = buildPrescription({ encounterStatus: "DRAFT" });
  const result = await updatePrescription(
    prescriptionId,
    { pupillaryDistance: 63 },
    clinicalActor,
    {
      updatePrescription: async (id, changes) => {
        assert.equal(id, prescriptionId);
        assert.equal(changes.pupillaryDistance, 63);
        return { prescription: expected, reason: null };
      },
    },
  );

  assert.equal(result.id, prescriptionId);
});

test("ventas recibe una vista sin metadatos clínicos internos", async () => {
  const result = await getPrescription(prescriptionId, salesActor, {
    findPrescriptionById: async () => buildPrescription(),
  });

  assert.equal(result.id, prescriptionId);
  assert.equal(Object.hasOwn(result, "encounterId"), false);
  assert.equal(Object.hasOwn(result, "replacementReason"), false);
});

test("ventas no puede ver recetas de atenciones en borrador", async () => {
  await assert.rejects(
    () =>
      getPrescription(prescriptionId, salesActor, {
        findPrescriptionById: async () =>
          buildPrescription({ encounterStatus: "DRAFT" }),
      }),
    (error) => error.code === "PRESCRIPTION_NOT_FOUND",
  );
});

test("ventas no puede ver versiones anuladas", async () => {
  await assert.rejects(
    () =>
      getPrescription(prescriptionId, salesActor, {
        findPrescriptionById: async () =>
          buildPrescription({ status: "VOIDED" }),
      }),
    (error) => error.code === "PRESCRIPTION_NOT_FOUND",
  );
});

test("el profesional asignado obtiene la receta completa", async () => {
  const result = await getPrescription(prescriptionId, clinicalActor, {
    findPrescriptionById: async () => buildPrescription(),
    hasClinicalAssignment: async () => true,
  });

  assert.equal(result.replacementReason, null);
  assert.equal(result.encounterId, encounterId);
});

test("un usuario clínico y de ventas conserva su vista clínica al estar asignado", async () => {
  const result = await getPrescription(
    prescriptionId,
    {
      permissions: [
        PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED,
        PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE,
      ],
      userId: professionalId,
    },
    {
      findPrescriptionById: async () => buildPrescription(),
      hasClinicalAssignment: async () => true,
    },
  );

  assert.equal(result.encounterId, encounterId);
  assert.equal(result.replacementReason, null);
});

test("un usuario clínico y de ventas usa la vista comercial si no está asignado", async () => {
  const result = await getPrescription(
    prescriptionId,
    {
      permissions: [
        PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED,
        PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE,
      ],
      userId: salesActor.userId,
    },
    {
      findPrescriptionById: async () => buildPrescription(),
      hasClinicalAssignment: async () => false,
    },
  );

  assert.equal(Object.hasOwn(result, "encounterId"), false);
  assert.equal(result.id, prescriptionId);
});

test("oculta al profesional un borrador ajeno", async () => {
  await assert.rejects(
    () =>
      getPrescription(prescriptionId, clinicalActor, {
        findPrescriptionById: async () =>
          buildPrescription({
            encounterStatus: "DRAFT",
            professionalId: salesActor.userId,
          }),
        hasClinicalAssignment: async () => true,
      }),
    (error) => error.code === "PRESCRIPTION_NOT_FOUND",
  );
});

test("ventas lista solo recetas activas y finalizadas", async () => {
  const result = await getPrescriptionList(
    new URLSearchParams({ patientId }),
    salesActor,
    {
      listPrescriptionsByPatientId: async () => [
        buildPrescription(),
        buildPrescription({ encounterStatus: "DRAFT", id: encounterId }),
        buildPrescription({ id: patientId, status: "VOIDED" }),
      ],
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].id, prescriptionId);
});

test("el profesional debe estar asignado para listar recetas", async () => {
  await assert.rejects(
    () =>
      getPrescriptionList(
        new URLSearchParams({ patientId }),
        clinicalActor,
        { hasClinicalAssignment: async () => false },
      ),
    (error) => error.code === "CLINICAL_ACCESS_NOT_ASSIGNED",
  );
});
