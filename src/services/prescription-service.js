import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { hasClinicalAssignment } from "../repositories/clinical-repository.js";
import {
  createOrReplacePrescription,
  findPrescriptionById,
  listPrescriptionsByPatientId,
  updatePrescription as updatePrescriptionRepository,
} from "../repositories/prescription-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCreatePrescriptionInput,
  validateEncounterId,
  validatePrescriptionId,
  validatePrescriptionListQuery,
  validateUpdatePrescriptionInput,
} from "../validations/clinical-validation.js";

function hasPermission(actor, permission) {
  return (actor?.permissions ?? []).includes(permission);
}

function throwPrescriptionNotFound() {
  throw new AppError({
    code: "PRESCRIPTION_NOT_FOUND",
    message: "No se encontró la receta óptica solicitada.",
    status: 404,
  });
}

function toSalesView(prescription) {
  return {
    fulfillmentNotes: prescription.fulfillmentNotes,
    id: prescription.id,
    issuedAt: prescription.issuedAt,
    issuedBy: prescription.issuedBy,
    leftEye: prescription.leftEye,
    patient: prescription.patient,
    pupillaryDistance: prescription.pupillaryDistance,
    rightEye: prescription.rightEye,
    status: prescription.status,
    version: prescription.version,
  };
}

function toClinicalView(prescription) {
  const result = { ...prescription };
  delete result.encounterStatus;
  delete result.professionalId;
  return result;
}

function convertRepositoryError(reason) {
  const errors = {
    ENCOUNTER_NOT_FOUND: [
      "CLINICAL_ENCOUNTER_NOT_FOUND",
      "No se encontró la atención clínica solicitada.",
      404,
    ],
    FINALIZED_WITHOUT_PRESCRIPTION: [
      "FINALIZED_ENCOUNTER_WITHOUT_PRESCRIPTION",
      "No se puede emitir por primera vez una receta después de finalizar la atención.",
      409,
    ],
    IMMUTABLE: [
      "PRESCRIPTION_IMMUTABLE",
      "La receta ya no puede editarse; emita una versión de reemplazo.",
      409,
    ],
    NOT_ASSIGNED: [
      "CLINICAL_ACCESS_NOT_ASSIGNED",
      "La atención no está asignada al profesional autenticado.",
      403,
    ],
    NOT_FOUND: [
      "PRESCRIPTION_NOT_FOUND",
      "No se encontró la receta óptica solicitada.",
      404,
    ],
    PRESCRIPTION_ALREADY_EXISTS: [
      "PRESCRIPTION_ALREADY_EXISTS",
      "La atención ya tiene una receta activa; actualícela mientras siga en borrador.",
      409,
    ],
    REPLACEMENT_REASON_REQUIRED: [
      "PRESCRIPTION_REPLACEMENT_REASON_REQUIRED",
      "Debe indicar el motivo para reemplazar una receta emitida.",
      400,
    ],
    UNEXPECTED_REPLACEMENT_REASON: [
      "UNEXPECTED_PRESCRIPTION_REPLACEMENT_REASON",
      "El motivo de reemplazo solo corresponde cuando ya existe una receta activa.",
      400,
    ],
  };
  const [code, message, status] = errors[reason] ?? errors.NOT_FOUND;

  throw new AppError({ code, message, status });
}

export async function createPrescription(
  encounterId,
  input,
  actor,
  dependencies = {},
) {
  const createRepository =
    dependencies.createOrReplacePrescription ?? createOrReplacePrescription;

  requirePermissions(actor, [PERMISSIONS.PRESCRIPTIONS_CREATE]);
  const normalizedEncounterId = validateEncounterId(encounterId);
  const prescriptionData = validateCreatePrescriptionInput(input);
  const result = await createRepository(
    normalizedEncounterId,
    prescriptionData,
    actor.userId,
    dependencies.currentDate ?? new Date(),
  );

  if (!result.prescription) {
    convertRepositoryError(result.reason);
  }

  return toClinicalView(result.prescription);
}

export async function updatePrescription(
  prescriptionId,
  input,
  actor,
  dependencies = {},
) {
  const updateRepository =
    dependencies.updatePrescription ?? updatePrescriptionRepository;

  requirePermissions(actor, [PERMISSIONS.PRESCRIPTIONS_CREATE]);
  const normalizedId = validatePrescriptionId(prescriptionId);
  const changes = validateUpdatePrescriptionInput(input);
  const result = await updateRepository(normalizedId, changes, actor.userId);

  if (!result.prescription) {
    convertRepositoryError(result.reason);
  }

  return toClinicalView(result.prescription);
}

export async function getPrescription(
  prescriptionId,
  actor,
  dependencies = {},
) {
  const findRepository =
    dependencies.findPrescriptionById ?? findPrescriptionById;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  const normalizedId = validatePrescriptionId(prescriptionId);
  const canReadAssigned = hasPermission(
    actor,
    PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED,
  );
  const canReadForSale = hasPermission(
    actor,
    PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE,
  );

  if (!canReadAssigned && !canReadForSale) {
    requirePermissions(actor, [PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED]);
  }

  const prescription = await findRepository(normalizedId);

  if (!prescription) {
    throwPrescriptionNotFound();
  }

  const assigned = canReadAssigned
    ? await assignmentRepository(prescription.patient.id, actor.userId)
    : false;

  if (assigned) {
    if (
      prescription.encounterStatus === "DRAFT" &&
      prescription.professionalId !== actor.userId
    ) {
      throwPrescriptionNotFound();
    }

    return toClinicalView(prescription);
  }

  if (canReadForSale) {
    if (
      prescription.status !== "ACTIVE" ||
      prescription.encounterStatus !== "FINALIZED"
    ) {
      throwPrescriptionNotFound();
    }

    return toSalesView(prescription);
  }

  if (canReadAssigned) {
    throw new AppError({
      code: "CLINICAL_ACCESS_NOT_ASSIGNED",
      message: "El paciente no está asignado al profesional autenticado.",
      status: 403,
    });
  }

  throwPrescriptionNotFound();
}

export async function getPrescriptionList(
  searchParams,
  actor,
  dependencies = {},
) {
  const listRepository =
    dependencies.listPrescriptionsByPatientId ?? listPrescriptionsByPatientId;
  const assignmentRepository =
    dependencies.hasClinicalAssignment ?? hasClinicalAssignment;
  const query = validatePrescriptionListQuery(searchParams);
  const canReadAssigned = hasPermission(
    actor,
    PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED,
  );
  const canReadForSale = hasPermission(
    actor,
    PERMISSIONS.PRESCRIPTIONS_READ_FOR_SALE,
  );
  let assigned = false;

  if (!canReadAssigned && !canReadForSale) {
    requirePermissions(actor, [PERMISSIONS.PRESCRIPTIONS_READ_ASSIGNED]);
  }

  if (canReadAssigned) {
    assigned = await assignmentRepository(query.patientId, actor.userId);

    if (!assigned && !canReadForSale) {
      throw new AppError({
        code: "CLINICAL_ACCESS_NOT_ASSIGNED",
        message: "El paciente no está asignado al profesional autenticado.",
        status: 403,
      });
    }
  }

  const prescriptions = await listRepository(query.patientId);

  return prescriptions
    .filter((prescription) => {
      if (!assigned) {
        return (
          prescription.status === "ACTIVE" &&
          prescription.encounterStatus === "FINALIZED"
        );
      }

      return (
        prescription.encounterStatus === "FINALIZED" ||
        prescription.professionalId === actor.userId
      );
    })
    .map((prescription) => {
      if (!assigned) {
        return toSalesView(prescription);
      }

      return toClinicalView(prescription);
    });
}
