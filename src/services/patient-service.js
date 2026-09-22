// Servicio de negocio que coordina reglas, permisos y persistencia de patient-service.
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

// Construir y lanzar el error de dominio asociado a throw paciente not found
function throwPatientNotFound() {
  throw new AppError({
    code: "PATIENT_NOT_FOUND",
    message: "No se encontró el paciente solicitado.",
    status: 404,
  });
}

// Centralizar la lógica de convert unique violation para mantener consistente el comportamiento de la aplicación
function convertUniqueViolation(error) {
  if (error?.code === "23505") {
    throw new AppError({
      code: "PATIENT_RUT_ALREADY_EXISTS",
      message: "Ya existe un paciente registrado con ese RUT.",
      status: 409,
      cause: error,
    });
  }

  throw error;
}

// Crear o registrar create paciente aplicando las reglas de negocio y persistencia correspondientes
export async function createPatient(input, actor, dependencies = {}) {
  const createPatientRepository =
    dependencies.createPatientWithGuardian ?? createPatientWithGuardian;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_MANAGE_BASIC]);

  const patientData = validateCreatePatientInput(
    input,
    dependencies.currentDate,
  );

  try {
    return await createPatientRepository(patientData, actor.userId);
  } catch (error) {
    return convertUniqueViolation(error);
  }
}

// Consultar get paciente y devolver los datos en el formato esperado por la capa llamadora
export async function getPatient(patientId, actor, dependencies = {}) {
  const findPatientRepository =
    dependencies.findPatientById ?? findPatientById;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_READ_BASIC]);

  const normalizedPatientId = validatePatientId(patientId);
  const patient = await findPatientRepository(normalizedPatientId);

  if (!patient) {
    throwPatientNotFound();
  }

  return patient;
}

// Consultar get paciente list y devolver los datos en el formato esperado por la capa llamadora
export async function getPatientList(searchParams, actor, dependencies = {}) {
  const listPatientRepository = dependencies.listPatients ?? listPatients;

  requirePermissions(actor, [PERMISSIONS.PATIENTS_READ_BASIC]);

  const query = validatePatientListQuery(searchParams);
  return listPatientRepository(query);
}

// Actualizar update paciente manteniendo las restricciones y estados permitidos del dominio
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
  const currentPatient = await findPatientRepository(normalizedPatientId);

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
    );

    if (!patient) {
      throwPatientNotFound();
    }

    return patient;
  } catch (error) {
    return convertUniqueViolation(error);
  }
}
