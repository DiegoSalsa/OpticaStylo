import { prisma } from "../db/prisma.js";

const issuerUser = "users_professional_profiles_user_idTousers";

function toNumber(value) {
  return value === null ? null : Number(value);
}

function mapPrescription(row) {
  if (!row) return null;
  const encounter = row.clinical_encounters;
  const issuer = row.professional_profiles[issuerUser];
  return {
    encounterId: row.encounter_id, fulfillmentNotes: row.fulfillment_notes, id: row.id,
    issuedAt: row.issued_at,
    issuedBy: { firstName: issuer.first_name, id: row.issued_by, lastName: issuer.last_name },
    leftEye: {
      addition: toNumber(row.left_addition), axis: row.left_axis,
      cylinder: toNumber(row.left_cylinder), sphere: toNumber(row.left_sphere),
    },
    patient: {
      firstNames: encounter.patients.first_names, id: encounter.patient_id,
      lastNames: encounter.patients.last_names, rut: encounter.patients.rut,
    },
    pupillaryDistance: toNumber(row.pupillary_distance),
    replacedPrescriptionId: row.replaced_prescription_id,
    replacementReason: row.replacement_reason,
    rightEye: {
      addition: toNumber(row.right_addition), axis: row.right_axis,
      cylinder: toNumber(row.right_cylinder), sphere: toNumber(row.right_sphere),
    },
    status: row.status, updatedAt: row.updated_at, version: row.version, voidedAt: row.voided_at,
  };
}

const prescriptionInclude = {
  clinical_encounters: { include: { patients: true } },
  professional_profiles: { include: { [issuerUser]: true } },
};

function withContext(row) {
  if (!row) return null;
  return {
    ...mapPrescription(row), encounterStatus: row.clinical_encounters.status,
    professionalId: row.clinical_encounters.professional_id,
  };
}

async function findPrescriptionWithClient(client, prescriptionId) {
  return withContext(await client.optical_prescriptions.findUnique({
    include: prescriptionInclude, where: { id: prescriptionId },
  }));
}

export async function findPrescriptionById(prescriptionId) {
  return findPrescriptionWithClient(prisma, prescriptionId);
}

export async function listPrescriptionsByPatientId(patientId) {
  return (await prisma.optical_prescriptions.findMany({
    include: prescriptionInclude,
    orderBy: [{ issued_at: "desc" }, { version: "desc" }],
    where: { clinical_encounters: { patient_id: patientId } },
  })).map(withContext);
}

function prescriptionData(data) {
  return {
    fulfillment_notes: data.fulfillmentNotes,
    left_addition: data.leftEye.addition, left_axis: data.leftEye.axis,
    left_cylinder: data.leftEye.cylinder, left_sphere: data.leftEye.sphere,
    pupillary_distance: data.pupillaryDistance,
    right_addition: data.rightEye.addition, right_axis: data.rightEye.axis,
    right_cylinder: data.rightEye.cylinder, right_sphere: data.rightEye.sphere,
  };
}

export async function createOrReplacePrescription(encounterId, prescription, actorUserId, issuedAt) {
  return prisma.$transaction(async (client) => {
    const encounter = await client.clinical_encounters.findUnique({ where: { id: encounterId } });
    if (!encounter) return { prescription: null, reason: "ENCOUNTER_NOT_FOUND" };
    if (encounter.professional_id !== actorUserId) return { prescription: null, reason: "NOT_ASSIGNED" };
    const active = await client.optical_prescriptions.findFirst({
      where: { encounter_id: encounterId, status: "ACTIVE" },
    });
    if (!active && encounter.status !== "DRAFT") return { prescription: null, reason: "FINALIZED_WITHOUT_PRESCRIPTION" };
    if (active && encounter.status === "DRAFT") return { prescription: null, reason: "PRESCRIPTION_ALREADY_EXISTS" };
    if (active && !prescription.replacementReason) return { prescription: null, reason: "REPLACEMENT_REASON_REQUIRED" };
    if (!active && prescription.replacementReason) return { prescription: null, reason: "UNEXPECTED_REPLACEMENT_REASON" };
    if (active) {
      await client.optical_prescriptions.update({
        data: { status: "VOIDED", voided_at: issuedAt }, where: { id: active.id },
      });
    }
    const created = await client.optical_prescriptions.create({ data: {
      ...prescriptionData(prescription), encounter_id: encounterId,
      issued_at: issuedAt, issued_by: actorUserId,
      replaced_prescription_id: active?.id ?? null,
      replacement_reason: prescription.replacementReason,
      version: active ? active.version + 1 : 1,
    } });
    return { prescription: await findPrescriptionWithClient(client, created.id), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function updatePrescription(prescriptionId, changes, actorUserId) {
  return prisma.$transaction(async (client) => {
    const current = await client.optical_prescriptions.findUnique({
      include: { clinical_encounters: true }, where: { id: prescriptionId },
    });
    if (!current) return { prescription: null, reason: "NOT_FOUND" };
    if (current.clinical_encounters.professional_id !== actorUserId) return { prescription: null, reason: "NOT_ASSIGNED" };
    if (current.status !== "ACTIVE" || current.clinical_encounters.status !== "DRAFT") {
      return { prescription: null, reason: "IMMUTABLE" };
    }
    const merged = {
      fulfillmentNotes: changes.fulfillmentNotes === undefined ? current.fulfillment_notes : changes.fulfillmentNotes,
      leftEye: changes.leftEye ?? {
        addition: toNumber(current.left_addition), axis: current.left_axis,
        cylinder: toNumber(current.left_cylinder), sphere: toNumber(current.left_sphere),
      },
      pupillaryDistance: changes.pupillaryDistance === undefined
        ? toNumber(current.pupillary_distance) : changes.pupillaryDistance,
      rightEye: changes.rightEye ?? {
        addition: toNumber(current.right_addition), axis: current.right_axis,
        cylinder: toNumber(current.right_cylinder), sphere: toNumber(current.right_sphere),
      },
    };
    await client.optical_prescriptions.update({ data: prescriptionData(merged), where: { id: prescriptionId } });
    return { prescription: await findPrescriptionWithClient(client, prescriptionId), reason: null };
  }, { isolationLevel: "Serializable" });
}
