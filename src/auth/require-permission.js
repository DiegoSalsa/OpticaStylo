import { AppError } from "../utils/app-error.js";

export function requirePermissions(actor, requiredPermissions) {
  if (!actor) {
    throw new AppError({
      code: "AUTHENTICATION_REQUIRED",
      message: "Debe iniciar sesión para realizar esta operación.",
      status: 401,
    });
  }

  const actorPermissions = new Set(actor.permissions ?? []);
  const hasEveryPermission = requiredPermissions.every((permission) =>
    actorPermissions.has(permission),
  );

  if (!hasEveryPermission) {
    throw new AppError({
      code: "INSUFFICIENT_PERMISSIONS",
      message: "No tiene permisos para realizar esta operación.",
      status: 403,
    });
  }
}
