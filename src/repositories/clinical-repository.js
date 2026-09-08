import { prisma } from "../db/prisma.js";

const profileUser = "users_professional_profiles_user_idTousers";
const MEDICAL_RECORD_COLUMNS = Object.freeze({
  allergies: "allergies", currentMedications: "current_medications",
  familyOcularHistory: "family_ocular_history",
  generalMedicalHistory: "general_medical_history", ocularHistory: "ocular_history",
});
const ENCOUNTER_COLUMNS = Object.freeze({
  anamnesis: "anamnesis", diagnosis: "diagnosis", examination: "examination",
  indications: "indications", reasonForVisit: "reason_for_visit",
});

function mapMedicalRecord(row) {
  return row ? {
    allergies: row.allergies, createdAt: row.created_at,
    currentMedications: row.current_medications,
    familyOcularHistory: row.family_ocular_history,
    generalMedicalHistory: row.general_medical_history, id: row.id,
    ocularHistory: row.ocular_history, patientId: row.patient_id, updatedAt: row.updated_at,
  } : null;
}

function mapRevision(row) {
  const user = row.professional_profiles[profileUser];
  return {
    allergies: row.allergies, changedFields: row.changed_fields,
    currentMedications: row.current_medications,
    familyOcularHistory: row.family_ocular_history,
    generalMedicalHistory: row.general_medical_history, id: row.id,
    ocularHistory: row.ocular_history, recordedAt: row.recorded_at,
    recordedBy: { firstName: user.first_name, id: row.recorded_by, lastName: user.last_name },
    revision: row.revision,
  };
}

function mapAddendum(row) {
  const user = row.professional_profiles[profileUser];
  return {
    authoredBy: { firstName: user.first_name, id: row.authored_by, lastName: user.last_name },
    content: row.content, createdAt: row.created_at, encounterId: row.encounter_id,
    id: row.id, reason: row.reason,
  };
}

function mapEncounter(row, additions = {}) {
  if (!row) return null;
  const professional = row.professional_profiles_clinical_encounters_professional_idToprofessional_profiles[profileUser];
  return {
    anamnesis: row.anamnesis, appointmentId: row.appointment_id, createdAt: row.created_at,
    diagnosis: row.diagnosis, examination: row.examination, finalizedAt: row.finalized_at,
    id: row.id, indications: row.indications,
    patient: {
      firstNames: row.patients.first_names, id: row.patient_id,
      lastNames: row.patients.last_names, rut: row.patients.rut,
    },
    professional: {
      firstName: professional.first_name, id: row.professional_id, lastName: professional.last_name,
    },
    reasonForVisit: row.reason_for_visit, status: row.status, updatedAt: row.updated_at,
    ...additions,
  };
}

const encounterInclude = {
  patients: true,
  professional_profiles_clinical_encounters_professional_idToprofessional_profiles: {
    include: { [profileUser]: true },
  },
};

async function findEncounterWithClient(client, encounterId) {
  return mapEncounter(await client.clinical_encounters.findUnique({
    include: encounterInclude, where: { id: encounterId },
  }));
}

export async function hasClinicalAssignment(patientId, professionalId, statuses = ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
  return (await prisma.appointments.count({
    where: { patient_id: patientId, professional_id: professionalId, status: { in: statuses } },
  })) > 0;
}

export async function findMedicalRecordByPatientId(patientId) {
  return mapMedicalRecord(await prisma.medical_records.findUnique({ where: { patient_id: patientId } }));
}

export async function listMedicalRecordRevisions(patientId) {
  const rows = await prisma.medical_record_revisions.findMany({
    include: { professional_profiles: { include: { [profileUser]: true } } },
    orderBy: { revision: "desc" }, where: { medical_records: { patient_id: patientId } },
  });
  return rows.map(mapRevision);
}

export async function upsertMedicalRecord(patientId, changes, actorUserId) {
  return prisma.$transaction(async (client) => {
    const patient = await client.patients.findUnique({ select: { id: true }, where: { id: patientId } });
    if (!patient) return null;
    const current = await client.medical_records.findUnique({ where: { patient_id: patientId } });
    const data = Object.fromEntries(Object.entries(changes).map(([field, value]) => [MEDICAL_RECORD_COLUMNS[field], value]));
    if (current && Object.entries(data).every(([field, value]) => current[field] === value)) {
      return mapMedicalRecord(current);
    }
    const record = current
      ? await client.medical_records.update({ data: { ...data, updated_by: actorUserId }, where: { id: current.id } })
      : await client.medical_records.create({ data: {
        allergies: changes.allergies ?? null, created_by: actorUserId,
        current_medications: changes.currentMedications ?? null,
        family_ocular_history: changes.familyOcularHistory ?? null,
        general_medical_history: changes.generalMedicalHistory ?? null,
        ocular_history: changes.ocularHistory ?? null, patient_id: patientId, updated_by: actorUserId,
      } });
    await client.medical_record_events.create({ data: {
      changed_fields: Object.keys(changes), event_type: current ? "UPDATED" : "CREATED",
      medical_record_id: record.id, performed_by: actorUserId,
    } });
    return mapMedicalRecord(record);
  }, { isolationLevel: "Serializable" });
}

export async function createClinicalEncounter(encounterData, actorUserId) {
  return prisma.$transaction(async (client) => {
    const appointment = await client.appointments.findUnique({ where: { id: encounterData.appointmentId } });
    if (!appointment) return { encounter: null, reason: "APPOINTMENT_NOT_FOUND" };
    if (appointment.professional_id !== actorUserId) return { encounter: null, reason: "NOT_ASSIGNED" };
    if (appointment.status !== "CHECKED_IN") return { encounter: null, reason: "INVALID_APPOINTMENT_STATUS" };
    if (await client.clinical_encounters.findUnique({ where: { appointment_id: appointment.id } })) {
      return { encounter: null, reason: "ENCOUNTER_ALREADY_EXISTS" };
    }
    const created = await client.clinical_encounters.create({ data: {
      anamnesis: encounterData.anamnesis, appointment_id: appointment.id,
      created_by: appointment.professional_id, diagnosis: encounterData.diagnosis,
      examination: encounterData.examination, indications: encounterData.indications,
      patient_id: appointment.patient_id, professional_id: appointment.professional_id,
      reason_for_visit: encounterData.reasonForVisit, updated_by: appointment.professional_id,
    } });
    await client.clinical_encounter_events.create({ data: {
      changed_fields: Object.keys(encounterData).filter((field) => field !== "appointmentId"),
      encounter_id: created.id, event_type: "CREATED", performed_by: actorUserId,
    } });
    return { encounter: await findEncounterWithClient(client, created.id), reason: null };
  }, { isolationLevel: "Serializable" });
}

async function loadAddenda(client, encounterId) {
  return (await client.clinical_encounter_addenda.findMany({
    include: { professional_profiles: { include: { [profileUser]: true } } },
    orderBy: [{ created_at: "asc" }, { id: "asc" }], where: { encounter_id: encounterId },
  })).map(mapAddendum);
}

export async function findClinicalEncounterById(encounterId) {
  const [row, addenda] = await Promise.all([
    prisma.clinical_encounters.findUnique({ include: encounterInclude, where: { id: encounterId } }),
    loadAddenda(prisma, encounterId),
  ]);
  return row ? mapEncounter(row, { addenda }) : null;
}

export async function findClinicalEncounterByAppointmentId(appointmentId) {
  const row = await prisma.clinical_encounters.findUnique({
    select: { id: true }, where: { appointment_id: appointmentId },
  });
  return row ? findClinicalEncounterById(row.id) : null;
}

export async function updateClinicalEncounter(encounterId, changes, actorUserId) {
  return prisma.$transaction(async (client) => {
    const current = await client.clinical_encounters.findUnique({ where: { id: encounterId } });
    if (!current) return { encounter: null, reason: "NOT_FOUND" };
    if (current.professional_id !== actorUserId) return { encounter: null, reason: "NOT_ASSIGNED" };
    if (current.status !== "DRAFT") return { encounter: null, reason: "FINALIZED" };
    const data = Object.fromEntries(Object.entries(changes).map(([field, value]) => [ENCOUNTER_COLUMNS[field], value]));
    await client.clinical_encounters.update({ data: { ...data, updated_by: actorUserId }, where: { id: encounterId } });
    await client.clinical_encounter_events.create({ data: {
      changed_fields: Object.keys(changes), encounter_id: encounterId,
      event_type: "UPDATED", performed_by: actorUserId,
    } });
    return { encounter: await findEncounterWithClient(client, encounterId), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function finalizeClinicalEncounter(encounterId, actorUserId, finalizedAt) {
  return prisma.$transaction(async (client) => {
    const current = await client.clinical_encounters.findUnique({
      include: { appointments: true }, where: { id: encounterId },
    });
    if (!current) return { encounter: null, reason: "NOT_FOUND" };
    if (current.professional_id !== actorUserId) return { encounter: null, reason: "NOT_ASSIGNED" };
    if (current.status !== "DRAFT") return { encounter: null, reason: "ALREADY_FINALIZED" };
    if (current.appointments.status !== "CHECKED_IN") return { encounter: null, reason: "INVALID_APPOINTMENT_STATUS" };
    if (!current.examination || !current.diagnosis) return { encounter: null, reason: "INCOMPLETE" };
    await client.clinical_encounters.update({ data: {
      finalized_at: finalizedAt, status: "FINALIZED", updated_by: actorUserId,
    }, where: { id: encounterId } });
    await client.appointments.update({ data: { status: "COMPLETED", updated_by: actorUserId }, where: { id: current.appointment_id } });
    await client.appointment_events.create({ data: {
      appointment_id: current.appointment_id,
      details: "Atención completada al finalizar el registro clínico.",
      event_type: "STATUS_CHANGED", new_status: "COMPLETED",
      performed_by: actorUserId, previous_status: "CHECKED_IN",
    } });
    await client.clinical_encounter_events.create({ data: {
      encounter_id: encounterId, event_type: "FINALIZED", performed_by: actorUserId,
    } });
    return { encounter: await findEncounterWithClient(client, encounterId), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function addClinicalEncounterAddendum(encounterId, addendumData, actorUserId) {
  return prisma.$transaction(async (client) => {
    const current = await client.clinical_encounters.findUnique({ where: { id: encounterId } });
    if (!current) return { addendum: null, patientId: null, reason: "NOT_FOUND" };
    if (current.professional_id !== actorUserId) return { addendum: null, patientId: current.patient_id, reason: "NOT_ASSIGNED" };
    if (current.status !== "FINALIZED") return { addendum: null, patientId: current.patient_id, reason: "NOT_FINALIZED" };
    const created = await client.clinical_encounter_addenda.create({
      data: { authored_by: actorUserId, content: addendumData.content, encounter_id: encounterId, reason: addendumData.reason },
      include: { professional_profiles: { include: { [profileUser]: true } } },
    });
    await client.clinical_encounter_events.create({ data: {
      encounter_id: encounterId, event_type: "ADDENDUM_ADDED", performed_by: actorUserId,
    } });
    return { addendum: mapAddendum(created), patientId: current.patient_id, reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function listPatientClinicalHistory(patientId) {
  const rows = await prisma.clinical_encounters.findMany({
    include: {
      ...encounterInclude,
      clinical_encounter_addenda: {
        include: { professional_profiles: { include: { [profileUser]: true } } },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ finalized_at: "desc" }, { id: "asc" }],
    where: { patient_id: patientId, status: "FINALIZED" },
  });
  return rows.map((row) => mapEncounter(row, { addenda: row.clinical_encounter_addenda.map(mapAddendum) }));
}
