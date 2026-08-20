import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  addClinicalEncounterAddendum,
  createClinicalEncounter,
  finalizeClinicalEncounter,
  findClinicalEncounterByAppointmentId,
  findClinicalEncounterById,
  findMedicalRecordByPatientId,
  hasClinicalAssignment,
  listPatientClinicalHistory,
  updateClinicalEncounter,
  upsertMedicalRecord,
} from "../repositories/clinical-repository.js";
import { findPatientById } from "../repositories/patient-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateAddendumInput,
  validateClinicalPatientId,
  validateCreateEncounterInput,
  validateEncounterId,
  validateMedicalRecordInput,
  validateUpdateEncounterInput,
} from "../validations/clinical-validation.js";
import { validateAppointmentId } from "../validations/appointment-validation.js";

function throwClinicalAccessNotAssigned() {
  throw new AppError({
    code: "CLINICAL_ACCESS_NOT_ASSIGNED",
    message: "El paciente no está asignado al profesional autenticado.",
    status: 403,
  });
}

function throwPatientNotFound() {
  throw new AppError({
    code: "PATIENT_NOT_FOUND",
    message: "No se encontró el paciente solicitado.",
    status: 404,
  });
}

function throwEncounterNotFound() {
  throw new AppError({
    code: "CLINICAL_ENCOUNTER_NOT_FOUND",
    message: "No se encontró la atención clínica solicitada.",
    status: 404,
  });
}

async function requirePatient(patientId, findRepository) {
  const patient = await findRepository(patientId);

  if (!patient) {
    throwPatientNotFound();
  }

  return patient;
}

async function requireAssignment(
  patientId,
  actor,
  assignmentRepository,
  statuses,
) {
  const assigned = await assignmentRepository(patientId, actor.userId, statuses);

  if (!assigned) {
    throwClinicalAccessNotAssigned();
  }
}

function convertEncounterRepositoryError(reason) {
  const errors = {
    ALREADY_FINALIZED: [
      "CLINICAL_ENCOUNTER_ALREADY_FINALIZED",
      "La atención clínica ya fue finalizada.",
      409,
    ],
    APPOINTMENT_NOT_FOUND: [
      "APPOINTMENT_NOT_FOUND",
      "No se encontró la reserva solicitada.",
      404,
    ],
    ENCOUNTER_ALREADY_EXISTS: [
      "CLINICAL_ENCOUNTER_ALREADY_EXISTS",
      "La reserva ya tiene una atención clínica asociada.",
      409,
    ],
    FINALIZED: [
      "CLINICAL_ENCOUNTER_IMMUTABLE",
      "Una atención finalizada no puede editarse; agregue una adenda.",
      409,
    ],
    INCOMPLETE: [
      "INCOMPLETE_CLINICAL_ENCOUNTER",
      "Debe registrar el examen y el diagnóstico antes de finalizar.",
      409,
    ],
    INVALID_APPOINTMENT_STATUS: [
      "APPOINTMENT_NOT_CHECKED_IN",
      "La reserva debe estar marcada como presente para registrar la atención.",
      409,
    ],
    NOT_ASSIGNED: [
      "CLINICAL_ACCESS_NOT_ASSIGNED",
      "La atención no está asignada al profesional autenticado.",
      403,
    ],
    NOT_FINALIZED: [
      "CLINICAL_ENCOUNTER_NOT_FINALIZED",
      "Las adendas solo se agregan a atenciones finalizadas.",
      409,
    ],
    NOT_FOUND: [
      "CLINICAL_ENCOUNTER_NOT_FOUND",
      "No se encontró la atención clínica solicitada.",
      404,
    ],
  };
  const [code, message, status] = errors[reason] ?? errors.NOT_FOUND;

  throw new AppError({ code, message, status });
}

export async function getMedicalRecord(patientId, actor, dependencies = {}) {
  const findPatientRepository = dependencies.findPatientById ?? findPatientById;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  const findRecordRepository =
    dependencies.findMedicalRecordByPatientId ?? findMedicalRecordByPatientId;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED]);
  const normalizedPatientId = validateClinicalPatientId(patientId);
  await requirePatient(normalizedPatientId, findPatientRepository);
  await requireAssignment(normalizedPatientId, actor, assignmentRepository);

  return {
    patientId: normalizedPatientId,
    record: await findRecordRepository(normalizedPatientId),
  };
}

export async function updateMedicalRecord(
  patientId,
  input,
  actor,
  dependencies = {},
) {
  const findPatientRepository = dependencies.findPatientById ?? findPatientById;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  const updateRepository =
    dependencies.upsertMedicalRecord ?? upsertMedicalRecord;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED]);
  const normalizedPatientId = validateClinicalPatientId(patientId);
  const changes = validateMedicalRecordInput(input);
  await requirePatient(normalizedPatientId, findPatientRepository);
  await requireAssignment(normalizedPatientId, actor, assignmentRepository, [
    "CHECKED_IN",
    "COMPLETED",
  ]);

  return updateRepository(normalizedPatientId, changes, actor.userId);
}

export async function createEncounter(input, actor, dependencies = {}) {
  const createRepository =
    dependencies.createClinicalEncounter ?? createClinicalEncounter;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED]);
  const encounterData = validateCreateEncounterInput(input);
  const result = await createRepository(encounterData, actor.userId);

  if (!result.encounter) {
    convertEncounterRepositoryError(result.reason);
  }

  return result.encounter;
}

export async function getEncounter(encounterId, actor, dependencies = {}) {
  const findRepository =
    dependencies.findClinicalEncounterById ?? findClinicalEncounterById;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED]);
  const normalizedId = validateEncounterId(encounterId);
  const encounter = await findRepository(normalizedId);

  if (!encounter) {
    throwEncounterNotFound();
  }

  if (
    encounter.status === "DRAFT" &&
    encounter.professional.id !== actor.userId
  ) {
    throwEncounterNotFound();
  }

  await requireAssignment(
    encounter.patient.id,
    actor,
    assignmentRepository,
  );
  return encounter;
}

export async function getEncounterForAppointment(appointmentId, actor, dependencies = {}) {
  const findRepository = dependencies.findClinicalEncounterByAppointmentId
    ?? findClinicalEncounterByAppointmentId;
  const assignmentRepository = dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED]);
  const encounter = await findRepository(validateAppointmentId(appointmentId));
  if (!encounter) return null;
  if (encounter.status === "DRAFT" && encounter.professional.id !== actor.userId) {
    return null;
  }
  await requireAssignment(encounter.patient.id, actor, assignmentRepository);
  return encounter;
}

export async function updateEncounter(
  encounterId,
  input,
  actor,
  dependencies = {},
) {
  const updateRepository =
    dependencies.updateClinicalEncounter ?? updateClinicalEncounter;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED]);
  const normalizedId = validateEncounterId(encounterId);
  const changes = validateUpdateEncounterInput(input);
  const result = await updateRepository(normalizedId, changes, actor.userId);

  if (!result.encounter) {
    convertEncounterRepositoryError(result.reason);
  }

  return result.encounter;
}

export async function finalizeEncounter(
  encounterId,
  actor,
  dependencies = {},
) {
  const finalizeRepository =
    dependencies.finalizeClinicalEncounter ?? finalizeClinicalEncounter;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED]);
  const normalizedId = validateEncounterId(encounterId);
  const result = await finalizeRepository(
    normalizedId,
    actor.userId,
    dependencies.currentDate ?? new Date(),
  );

  if (!result.encounter) {
    convertEncounterRepositoryError(result.reason);
  }

  return result.encounter;
}

export async function addEncounterAddendum(
  encounterId,
  input,
  actor,
  dependencies = {},
) {
  const findRepository =
    dependencies.findClinicalEncounterById ?? findClinicalEncounterById;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  const addRepository =
    dependencies.addClinicalEncounterAddendum ?? addClinicalEncounterAddendum;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_WRITE_ASSIGNED]);
  const normalizedId = validateEncounterId(encounterId);
  const addendumData = validateAddendumInput(input);
  const encounter = await findRepository(normalizedId);

  if (!encounter) {
    throwEncounterNotFound();
  }

  await requireAssignment(
    encounter.patient.id,
    actor,
    assignmentRepository,
    ["CHECKED_IN", "COMPLETED"],
  );
  const result = await addRepository(normalizedId, addendumData, actor.userId);

  if (!result.addendum) {
    convertEncounterRepositoryError(result.reason);
  }

  return result.addendum;
}

export async function getPatientClinicalHistory(
  patientId,
  actor,
  dependencies = {},
) {
  const findPatientRepository = dependencies.findPatientById ?? findPatientById;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  const historyRepository =
    dependencies.listPatientClinicalHistory ?? listPatientClinicalHistory;

  requirePermissions(actor, [PERMISSIONS.MEDICAL_RECORDS_READ_ASSIGNED]);
  const normalizedPatientId = validateClinicalPatientId(patientId);
  await requirePatient(normalizedPatientId, findPatientRepository);
  await requireAssignment(normalizedPatientId, actor, assignmentRepository);

  return {
    encounters: await historyRepository(normalizedPatientId),
    patientId: normalizedPatientId,
  };
}
