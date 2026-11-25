import { operationBranch } from "../auth/branch-identity.js";
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  createPatientWithGuardian,
  findPatientById,
  listPatients,
  updatePatientWithGuardian,
} from "../repositories/patient-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCreatePatientInput,
  validatePatientId,
  validatePatientListQuery,
  validateUpdatePatientInput,
} from "../validations/patient-validation.js";

function throwPatientNotFound() {
  throw new AppError({
    code: "PATIENT_NOT_FOUND",
    message: "No se encontró el paciente solicitado.",
    status: 404,
  });
}

function convertUniqueViolation(error) {
  if (["23505","P2002"].includes(error?.code)) {
    throw new AppError({
      code: "PATIENT_RUT_ALREADY_EXISTS",
      message: "Ya existe un paciente registrado con ese RUT.",
      status: 409,
      cause: error,
    });
  }

  throw error;
}

export async function createPatient(input, actor, dependencies = {}) {
  const createPatientRepository =
    dependencies.createPatientWithGuardian ?? createPatientWithGuardian;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_MANAGE_BASIC]);

  const patientData = validateCreatePatientInput(
    input,
    dependencies.currentDate,
  );

  try {
    return await createPatientRepository(patientData, actor.userId, ...(dependencies.createPatientWithGuardian ? [] : [actor, input.branchId]));
  } catch (error) {
    return convertUniqueViolation(error);
  }
}

export async function getPatient(patientId, actor, dependencies = {}) {
  const findPatientRepository =
    dependencies.findPatientById ?? findPatientById;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_READ_BASIC]);

  const normalizedPatientId = validatePatientId(patientId);
  const branchId = dependencies.branchId ? await operationBranch(actor, dependencies.branchId) : null;
  const scopeActor = branchId ? { ...actor, activeBranchId: branchId } : actor;
  const patient = await findPatientRepository(normalizedPatientId, ...(dependencies.findPatientById ? [] : [scopeActor]));

  if (!patient) {
    throwPatientNotFound();
  }

  return patient;
}

export async function getPatientList(searchParams, actor, dependencies = {}) {
  const listPatientRepository = dependencies.listPatients ?? listPatients;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_READ_BASIC]);

  const query = validatePatientListQuery(searchParams);
  const requested = searchParams.get("branchId");
  const scopeActor = requested ? { ...actor, activeBranchId: await operationBranch(actor, requested) } : actor;
  return listPatientRepository(query, ...(dependencies.listPatients ? [] : [scopeActor]));
}

export async function updatePatient(
  patientId,
  input,
  actor,
  dependencies = {},
) {
  const findPatientRepository =
    dependencies.findPatientById ?? findPatientById;
  const updatePatientRepository =
    dependencies.updatePatientWithGuardian ?? updatePatientWithGuardian;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_MANAGE_BASIC]);

  const normalizedPatientId = validatePatientId(patientId);
  const currentPatient = await findPatientRepository(normalizedPatientId, ...(dependencies.findPatientById ? [] : [actor]));

  if (!currentPatient) {
    throwPatientNotFound();
  }

  const patientData = validateUpdatePatientInput(
    input,
    currentPatient,
    dependencies.currentDate,
  );

  try {
    const patient = await updatePatientRepository(
      normalizedPatientId,
      patientData,
      actor.userId,
      ...(dependencies.updatePatientWithGuardian ? [] : [actor]),
    );

    if (!patient) {
      throwPatientNotFound();
    }

    return patient;
  } catch (error) {
    return convertUniqueViolation(error);
  }
}
