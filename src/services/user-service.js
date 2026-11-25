import { authorizedBranchIds, branchAccessDenied } from "../auth/branch-access.js";
import { inventoryId } from "../validations/inventory-validation.js";
import { hashPassword } from "../auth/password.js";
import { hasGlobalBranchAccess, PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import {
  createUserWithRoles,
  findUserById,
  listUsers,
  updateUserWithRoles,
} from "../repositories/user-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateCreateUserInput,
  validateUpdateUserInput,
  validateUserId,
  validateUserListQuery,
} from "../validations/user-validation.js";

function isUniqueViolation(error) {
  return error?.code === "23505";
}

export async function createUser(input, actor, dependencies = {}) {
  const createUserRepository =
    dependencies.createUserWithRoles ?? createUserWithRoles;
  const passwordHasher = dependencies.hashPassword ?? hashPassword;

  requirePermissions(actor, [
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_ASSIGN_ROLES,
  ]);

  const userData = validateCreateUserInput(input);
  if (!dependencies.createUserWithRoles && !hasGlobalBranchAccess(actor)) {
    if (userData.roles.some((role) => !["SALES", "CLINICAL_PROFESSIONAL"].includes(role))) throw branchAccessDenied();
    const allowed = await authorizedBranchIds(actor);
    const selected = input.branchId ?? actor.activeBranchId ?? (allowed.length === 1 ? allowed[0] : null);
    userData.branchId = inventoryId(selected);
    if (!allowed.includes(userData.branchId)) throw branchAccessDenied();
  }
  const passwordHash = await passwordHasher(userData.password);

  try {
    const user = await createUserRepository(
      {
        ...userData,
        password: undefined,
        passwordHash,
      },
      actor.userId,
      ...(dependencies.createUserWithRoles ? [] : [actor]),
    );

    if (!user) {
      throw new AppError({
        code: "INVALID_USER_ROLES",
        message: "Uno o más roles no están disponibles.",
        status: 400,
      });
    }

    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: "USER_EMAIL_ALREADY_EXISTS",
        message: "Ya existe un usuario con ese correo electrónico.",
        status: 409,
      });
    }

    throw error;
  }
}

export async function getUserList(searchParams, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.USERS_READ]);
  const query = validateUserListQuery(searchParams);
  return dependencies.listUsers ? dependencies.listUsers(query) : listUsers(query, actor);
}

export async function getUser(userId, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.USERS_READ]);
  const id = validateUserId(userId);
  const user = await (dependencies.findUserById ? dependencies.findUserById(id) : findUserById(id, actor));
  if (!user) {
    throw new AppError({ code: "USER_NOT_FOUND", message: "No se encontró el usuario.", status: 404 });
  }
  return user;
}

export async function updateUser(userId, input, actor, dependencies = {}) {
  requirePermissions(actor, [PERMISSIONS.USERS_UPDATE]);
  if (Object.hasOwn(input ?? {}, "roles")) {
    requirePermissions(actor, [PERMISSIONS.USERS_ASSIGN_ROLES]);
  }
  if (Object.hasOwn(input ?? {}, "isActive")) {
    requirePermissions(actor, [PERMISSIONS.USERS_DEACTIVATE]);
  }

  const id = validateUserId(userId);
  const current = await (dependencies.findUserById ? dependencies.findUserById(id) : findUserById(id, actor, { write: true }));
  if (!current) {
    throw new AppError({ code: "USER_NOT_FOUND", message: "No se encontró el usuario.", status: 404 });
  }
  if (id === actor.userId && input?.isActive === false) {
    throw new AppError({
      code: "CANNOT_DEACTIVATE_CURRENT_USER",
      message: "No puede desactivar la cuenta con la que inició sesión.",
      status: 409,
    });
  }

  const data = validateUpdateUserInput(input, current);
  const rolesChanged = [...data.roles].sort().join("|") !== [...current.roles].sort().join("|");
  const passwordHash = data.password
    ? await (dependencies.hashPassword ?? hashPassword)(data.password)
    : null;
  try {
    const result = await (dependencies.updateUserWithRoles ?? updateUserWithRoles)(
      id,
      {
        ...data,
        password: undefined,
        passwordHash,
        revokeSessions: Boolean(passwordHash) || rolesChanged || data.isActive !== current.isActive,
      },
      actor.userId,
      ...(dependencies.updateUserWithRoles ? [] : [actor]),
    );
    if (result.reason === "LAST_ACTIVE_ADMIN") {
      throw new AppError({
        code: "LAST_ACTIVE_ADMIN",
        message: "Debe conservar al menos un administrador activo.",
        status: 409,
      });
    }
    if (result.reason === "INVALID_USER_ROLES") {
      throw new AppError({ code: "INVALID_USER_ROLES", message: "Uno o más roles no están disponibles.", status: 400 });
    }
    if (!result.user) {
      throw new AppError({ code: "USER_NOT_FOUND", message: "No se encontró el usuario.", status: 404 });
    }
    return result.user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        code: "USER_EMAIL_ALREADY_EXISTS",
        message: "Ya existe un usuario con ese correo electrónico.",
        status: 409,
      });
    }
    throw error;
  }
}
