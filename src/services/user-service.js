import { hashPassword } from "../auth/password.js";
import { PERMISSIONS } from "../auth/permissions.js";
import { requirePermissions } from "../auth/require-permission.js";
import { createUserWithRoles } from "../repositories/user-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateCreateUserInput } from "../validations/user-validation.js";

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
  const passwordHash = await passwordHasher(userData.password);

  try {
    const user = await createUserRepository(
      {
        ...userData,
        password: undefined,
        passwordHash,
      },
      actor.userId,
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
