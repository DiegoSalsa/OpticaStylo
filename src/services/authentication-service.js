import { verifyPassword } from "../auth/password.js";
import { createSessionToken, hashSessionToken } from "../auth/session-token.js";
import {
  createSessionForSuccessfulLogin,
  revokeSession,
} from "../repositories/session-repository.js";
import {
  findUserForAuthentication,
  recordFailedLogin,
} from "../repositories/user-repository.js";
import { AppError } from "../utils/app-error.js";
import { validateLoginInput } from "../validations/user-validation.js";

const MAXIMUM_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const DUMMY_PASSWORD_HASH =
  "scrypt$131072$8$1$1VpTqz7qaGhSriwQ89u7mw$VvWr9s_9jrqhj73MssrTKvfSRJ1rYTfKsDYqvrt29rIZ9AIKwUZwklSKLWdI5Z_yob175zu9y-I4g3crAMe21Q";

function throwInvalidCredentials() {
  throw new AppError({
    code: "INVALID_CREDENTIALS",
    message: "El correo electrónico o la contraseña son incorrectos.",
    status: 401,
  });
}

export async function login(input, requestMetadata = {}, dependencies = {}) {
  const findUser =
    dependencies.findUserForAuthentication ?? findUserForAuthentication;
  const passwordVerifier = dependencies.verifyPassword ?? verifyPassword;
  const failedLoginRecorder =
    dependencies.recordFailedLogin ?? recordFailedLogin;
  const sessionCreator =
    dependencies.createSessionForSuccessfulLogin ??
    createSessionForSuccessfulLogin;
  const tokenCreator = dependencies.createSessionToken ?? createSessionToken;
  const tokenHasher = dependencies.hashSessionToken ?? hashSessionToken;
  const credentials = validateLoginInput(input);
  const user = await findUser(credentials.email);
  const passwordIsValid = await passwordVerifier(
    credentials.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !user.isActive || !passwordIsValid) {
    if (user?.isActive) {
      await failedLoginRecorder(user.id, MAXIMUM_LOGIN_ATTEMPTS, LOCK_MINUTES);
    }

    throwInvalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throwInvalidCredentials();
  }

  const token = tokenCreator();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1_000);
  const session = await sessionCreator({
    expiresAt,
    ipAddress: requestMetadata.ipAddress ?? null,
    tokenHash: tokenHasher(token),
    userAgent: requestMetadata.userAgent?.slice(0, 512) ?? null,
    userId: user.id,
  });

  return {
    maxAgeSeconds: SESSION_DURATION_SECONDS,
    session: {
      expiresAt: session.expiresAt,
      id: session.id,
    },
    token,
    user: {
      email: user.email,
      firstName: user.firstName,
      id: user.id,
      lastName: user.lastName,
      roles: user.roles,
    },
  };
}

export async function logout(actor, dependencies = {}) {
  const sessionRevoker = dependencies.revokeSession ?? revokeSession;

  await sessionRevoker(actor.sessionId, actor.userId);
}
