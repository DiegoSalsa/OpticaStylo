import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSessionToken, hashSessionToken } from "../auth/session-token.js";
import {
  createCustomerAccount,
  createCustomerSession,
  findCustomerAccountForAuthentication,
  recordCustomerFailedLogin,
  revokeCustomerSession,
} from "../repositories/store-account-repository.js";
import { AppError } from "../utils/app-error.js";
import {
  validateStoreAccountRegistration,
  validateStoreLogin,
} from "../validations/store-validation.js";

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAXIMUM_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DUMMY_PASSWORD_HASH =
  "scrypt$131072$8$1$1VpTqz7qaGhSriwQ89u7mw$VvWr9s_9jrqhj73MssrTKvfSRJ1rYTfKsDYqvrt29rIZ9AIKwUZwklSKLWdI5Z_yob175zu9y-I4g3crAMe21Q";

function publicAccount(account) {
  return {
    address: account.address,
    customerId: account.customerId,
    email: account.email,
    firstNames: account.firstNames,
    id: account.id,
    lastNames: account.lastNames,
    phone: account.phone,
    rut: account.rut,
  };
}

function invalidCredentials() {
  throw new AppError({
    code: "INVALID_CUSTOMER_CREDENTIALS",
    message: "El correo electrónico o la contraseña son incorrectos.",
    status: 401,
  });
}

async function issueSession(account, metadata, dependencies) {
  const token = (dependencies.createSessionToken ?? createSessionToken)();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const session = await (dependencies.createCustomerSession ?? createCustomerSession)({
    accountId: account.id,
    expiresAt,
    ipAddress: metadata.ipAddress ?? null,
    tokenHash: (dependencies.hashSessionToken ?? hashSessionToken)(token),
    userAgent: metadata.userAgent?.slice(0, 512) ?? null,
  });
  return {
    account: publicAccount(account),
    maxAgeSeconds: SESSION_SECONDS,
    session,
    token,
  };
}

export async function registerStoreAccount(input, metadata = {}, dependencies = {}) {
  const account = validateStoreAccountRegistration(input);
  const passwordHash = await (dependencies.hashPassword ?? hashPassword)(account.password);
  try {
    const created = await (dependencies.createCustomerAccount ?? createCustomerAccount)({
      ...account,
      passwordHash,
    });
    return issueSession(created, metadata, dependencies);
  } catch (error) {
    if (error?.code !== "23505") throw error;
    const emailConflict = error.constraint === "customer_accounts_email_unique";
    throw new AppError({
      code: emailConflict ? "CUSTOMER_ACCOUNT_EMAIL_EXISTS" : "CUSTOMER_ACCOUNT_REQUIRES_LINKING",
      message: emailConflict
        ? "Ya existe una cuenta con ese correo electrónico."
        : "Los datos ya pertenecen a un cliente. El negocio debe vincular la cuenta de forma segura.",
      status: 409,
    });
  }
}

export async function loginStoreAccount(input, metadata = {}, dependencies = {}) {
  const credentials = validateStoreLogin(input);
  const account = await (
    dependencies.findCustomerAccountForAuthentication ?? findCustomerAccountForAuthentication
  )(credentials.email);
  const valid = await (dependencies.verifyPassword ?? verifyPassword)(
    credentials.password,
    account?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!account || !account.isActive || !valid) {
    if (account?.isActive) {
      await (dependencies.recordCustomerFailedLogin ?? recordCustomerFailedLogin)(
        account.id,
        MAXIMUM_LOGIN_ATTEMPTS,
        LOCK_MINUTES,
      );
    }
    invalidCredentials();
  }
  if (account.lockedUntil && account.lockedUntil > new Date()) invalidCredentials();
  return issueSession(account, metadata, dependencies);
}

export async function logoutStoreAccount(account, dependencies = {}) {
  await (dependencies.revokeCustomerSession ?? revokeCustomerSession)(
    account.sessionId,
    account.id,
  );
}

export function getStoreAccountProfile(account) {
  return publicAccount(account);
}
