import { requireClinicalProfessional } from "../auth/clinical-professional.js";
import { addClinicalEncounterAddendum, createClinicalEncounter, finalizeClinicalEncounter, findClinicalEncounterByAppointmentId, findClinicalEncounterById, findMedicalRecordByPatientId, hasClinicalAssignment, listMedicalRecordRevisions, listPatientClinicalHistory, updateClinicalEncounter, upsertMedicalRecord, recordClinicalAccess } from "../repositories/clinical-repository.js";
import { validateAddendumInput, validateClinicalPatientId, validateCreateEncounterInput, validateEncounterId, validateMedicalRecordInput, validateUpdateEncounterInput } from "../validations/clinical-validation.js";
import { validateAppointmentId } from "../validations/appointment-validation.js";
import { clinicalInvalid, clinicalObject, clinicalVersion } from "../validations/clinical-form-validation.js";
function reasonError(reason) {
  const errors = {
    NOT_FOUND: ["No se encontró la atención clínica.", 404],
    NOT_ASSIGNED: ["No tiene asignación clínica para esa atención.", 403],
    APPOINTMENT_NOT_FOUND: ["No se encontró la reserva autorizada.", 404],
    INVALID_APPOINTMENT_STATUS: ["La reserva debe estar marcada como presente.", 409],
    ENCOUNTER_ALREADY_EXISTS: ["La reserva ya tiene una atención clínica.", 409],
    FINALIZED: ["La ficha finalizada es inmutable; utilice una adenda.", 409],
    NOT_FINALIZED: ["Las adendas se agregan después de finalizar la atención.", 409],
    INCOMPLETE: ["Complete el examen y diagnóstico de la ficha general antes de finalizar.", 409]
  };
  const [message, status] = errors[reason] ?? errors.NOT_FOUND;
  clinicalInvalid(message, `CLINICAL_${reason}`, status);
}
const responseRecord = record => ({
  ...record,
  revisions: (record.revisions ?? []).map(({
    snapshot: _snapshot,
    ...metadata
  }) => metadata)
});
async function requireAssignment(patientId, actor, statuses) {
  if (!(await hasClinicalAssignment(patientId, actor.userId, statuses))) clinicalInvalid("No tiene asignación clínica para ese paciente.", "CLINICAL_ACCESS_NOT_ASSIGNED", 403);
}
export async function getMedicalRecord(patientId, actor) {
  await requireClinicalProfessional(actor);
  const id = validateClinicalPatientId(patientId);
  await requireAssignment(id, actor);
  const record = await findMedicalRecordByPatientId(id);
  return {
    patientId: id,
    record,
    revisions: record ? await listMedicalRecordRevisions(id) : []
  };
}
export async function updateMedicalRecord(patientId, input, actor) {
  await requireClinicalProfessional(actor, "medical_records.write_assigned");
  const id = validateClinicalPatientId(patientId);
  await requireAssignment(id, actor, ["CHECKED_IN", "COMPLETED"]);
  if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) clinicalInvalid("Indique la revisión de los antecedentes que está editando.");
  return upsertMedicalRecord(id, validateMedicalRecordInput(input), actor.userId, input.expectedRevision);
}
export async function createEncounter(input, actor, {
  requestKey
} = {}) {
  await requireClinicalProfessional(actor, "medical_records.write_assigned");
  const data = validateCreateEncounterInput(input);
  if (!requestKey && !data.appointmentId) clinicalInvalid("La atención sin reserva requiere un identificador de operación.", "IDEMPOTENCY_KEY_REQUIRED");
  const result = await createClinicalEncounter(data, actor.userId, requestKey);
  if (!result.encounter) reasonError(result.reason);
  return responseRecord(await findClinicalEncounterById(result.encounter.id));
}
export async function getEncounter(encounterId, actor, {
  patientId,
  revision,
  accessType = "VIEWED"
} = {}) {
  await requireClinicalProfessional(actor);
  const id = validateEncounterId(encounterId),
    encounter = await findClinicalEncounterById(id);
  if (!encounter || encounter.status === "DRAFT" && encounter.professional.id !== actor.userId || patientId && validateClinicalPatientId(patientId) !== encounter.patient.id) reasonError("NOT_FOUND");
  await requireAssignment(encounter.patient.id, actor);
  let result = encounter;
  if (revision != null) {
    const version = Number(revision);
    clinicalVersion(version);
    const saved = encounter.revisions.find(r => r.version === version);
    if (!saved) reasonError("NOT_FOUND");
    const s = saved.snapshot;
    result = {
      ...encounter,
      type: s.encounter_type,
      encounterDate: s.encounter_date,
      recordNumber: s.record_number,
      formVersion: s.form_version,
      formData: s.form_data,
      version: s.record_version,
      currentVersion: encounter.version,
      isHistoricalVersion: true,
      updatedAt: saved.recordedAt,
      reasonForVisit: s.reason_for_visit,
      anamnesis: s.anamnesis,
      examination: s.examination,
      diagnosis: s.diagnosis,
      indications: s.indications,
      status: s.status,
      finalizedAt: s.finalized_at,
      patientSnapshot: s.patient_snapshot,
      professionalSnapshot: s.professional_snapshot,
      addenda: encounter.addenda.filter(a => new Date(a.createdAt) <= new Date(saved.recordedAt))
    };
  }
  await recordClinicalAccess(id, actor.userId, accessType);
  return {
    ...result,
    revisions: encounter.revisions.map(({
      snapshot: _snapshot,
      ...metadata
    }) => metadata)
  };
}
export async function getEncounterForAppointment(appointmentId, actor) {
  await requireClinicalProfessional(actor);
  const encounter = await findClinicalEncounterByAppointmentId(validateAppointmentId(appointmentId));
  if (!encounter) return null;
  return getEncounter(encounter.id, actor);
}
export async function updateEncounter(encounterId, input, actor) {
  await requireClinicalProfessional(actor, "medical_records.write_assigned");
  const id = validateEncounterId(encounterId),
    data = validateUpdateEncounterInput(input);
  const result = await updateClinicalEncounter(id, data, actor.userId);
  if (!result.encounter) reasonError(result.reason);
  return findClinicalEncounterById(id).then(({
    revisions,
    ...record
  }) => ({
    ...record,
    revisions: revisions.map(({
      snapshot: _snapshot,
      ...metadata
    }) => metadata)
  }));
}
export async function finalizeEncounter(encounterId, input, actor) {
  await requireClinicalProfessional(actor, "medical_records.write_assigned");
  clinicalObject(input, ["expectedVersion", "confirm"]);
  if (input.confirm !== true) clinicalInvalid("Confirme la finalización profesional de la atención.");
  const result = await finalizeClinicalEncounter(validateEncounterId(encounterId), actor.userId, new Date(), {
    expectedVersion: clinicalVersion(input.expectedVersion)
  });
  if (!result.encounter) reasonError(result.reason);
  return getEncounter(result.encounter.id, actor);
}
export async function addEncounterAddendum(encounterId, input, actor, {
  requestKey
} = {}) {
  await requireClinicalProfessional(actor, "medical_records.write_assigned");
  if (!requestKey) clinicalInvalid("La adenda requiere un identificador de operación.", "IDEMPOTENCY_KEY_REQUIRED");
  const id = validateEncounterId(encounterId);
  await getEncounter(id, actor);
  const result = await addClinicalEncounterAddendum(id, validateAddendumInput(input), actor.userId, requestKey);
  if (!result.addendum) reasonError(result.reason);
  return result.addendum;
}
export async function getPatientClinicalHistory(patientId, actor, {
  page = 1
} = {}) {
  await requireClinicalProfessional(actor);
  const id = validateClinicalPatientId(patientId);
  await requireAssignment(id, actor);
  const value = Number(page);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) clinicalInvalid("La página del historial no es válida.");
  return {
    patientId: id,
    ...(await listPatientClinicalHistory(id, actor.userId, value))
  };
}
