import { PERMISSIONS } from "./permissions.js";
import { AppError } from "../utils/app-error.js";

export function requireScheduleManagement(actor, professionalId) {
  if (!actor) {
    throw new AppError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Debe iniciar sesión para realizar esta operación.",
      status: 401,
    });
  }

  const permissions = new Set(actor.permissions ?? []);
  const canManageAll = permissions.has(PERMISSIONS.SCHEDULES_MANAGE_ALL);
  const canManageOwn =
    actor.userId === professionalId &&
    permissions.has(PERMISSIONS.SCHEDULES_MANAGE_OWN);

  if (!canManageAll && !canManageOwn) {
    throw new AppError({
      code: "INSUFFICIENT_PERMISSIONS",
      message: "No tiene permisos para gestionar esta agenda.",
      status: 403,
    });
  }
}
