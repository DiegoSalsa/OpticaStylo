import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  createProfessionalProfile,
  findProfessionalById,
  listProfessionalProfiles,
  updateProfessionalProfile,
} from "../repositories/professional-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCreateProfessionalInput,
  validateProfessionalId,
  validateUpdateProfessionalInput,
} from "../validations/professional-validation.js";

function throwProfessionalNotFound() {
  throw new AppError({
    code: "PROFESSIONAL_NOT_FOUND",
    message: "No se encontró el profesional solicitado.",
    status: 404,
  });
}

export async function createProfessional(input, actor, dependencies = {}) {
  const createRepository =
    dependencies.createProfessionalProfile ?? createProfessionalProfile;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_MANAGE_ALL]);
  const profileData = validateCreateProfessionalInput(input);

  try {
    const professional = await createRepository(profileData, actor.userId);

    if (!professional) {
      throw new AppError({
        code: "CLINICAL_USER_NOT_FOUND",
        message:
          "El usuario debe existir, estar activo y tener el rol de profesional clínico.",
        status: 404,
      });
    }

    return professional;
  } catch (error) {
    if (error?.code === "23505") {
      throw new AppError({
        code: "PROFESSIONAL_ALREADY_EXISTS",
        message: "El usuario ya posee un perfil profesional.",
        status: 409,
        cause: error,
      });
    }

    throw error;
  }
}

export async function getProfessional(professionalId, actor, dependencies = {}) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_READ]);
  const normalizedId = validateProfessionalId(professionalId);
  const professional = await findRepository(normalizedId);

  if (!professional) {
    throwProfessionalNotFound();
  }

  return professional;
}

export async function getProfessionals(actor, dependencies = {}) {
  const listRepository =
    dependencies.listProfessionalProfiles ?? listProfessionalProfiles;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_READ]);
  return listRepository();
}

export async function updateProfessional(
  professionalId,
  input,
  actor,
  dependencies = {},
) {
  const findRepository = dependencies.findProfessionalById ?? findProfessionalById;
  const updateRepository =
    dependencies.updateProfessionalProfile ?? updateProfessionalProfile;

  requirePermissions(actor, [PERMISSIONS.SCHEDULES_MANAGE_ALL]);
  const normalizedId = validateProfessionalId(professionalId);
  const currentProfessional = await findRepository(normalizedId);

  if (!currentProfessional) {
    throwProfessionalNotFound();
  }

  const profileData = validateUpdateProfessionalInput(
    input,
    currentProfessional,
  );
  const professional = await updateRepository(
    normalizedId,
    profileData,
    actor.userId,
  );

  if (!professional) {
    throwProfessionalNotFound();
  }

  return professional;
}
