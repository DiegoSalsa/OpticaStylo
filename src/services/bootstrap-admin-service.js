import { hashPassword } from "../auth/password.js";
import { ROLES } from "../auth/roles.js";
import { createInitialAdmin } from "../repositories/user-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateCreateUserInput } from "../validations/user-validation.js";

export async function bootstrapInitialAdmin(input, dependencies = {}) {
  const passwordHasher = dependencies.hashPassword ?? hashPassword;
  const adminCreator = dependencies.createInitialAdmin ?? createInitialAdmin;
  const userData = validateCreateUserInput({
    ...input,
    roles: [ROLES.ADMIN],
  });
  const passwordHash = await passwordHasher(userData.password);
  const user = await adminCreator({
    ...userData,
    password: undefined,
    passwordHash,
  });

  if (!user) {
    throw new AppError({
      code: "INITIAL_ADMIN_ALREADY_EXISTS",
      message: "La aplicación ya contiene usuarios y no permite inicializar otro administrador.",
      status: 409,
    });
  }

  return user;
}
