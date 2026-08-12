import assert from "node:assert/strict";
import test from "node:test";

import {
  login,
  logout,
} from "../../src/services/authentication-service.js";

const credentials = {
  email: "admin@example.com",
  password: "contraseña correcta del administrador",
};
const activeUser = {
  email: credentials.email,
  firstName: "Ada",
  id: "00000000-0000-4000-8000-000000000001",
  isActive: true,
  lastName: "Lovelace",
  lockedUntil: null,
  passwordHash: "hash-almacenado",
  roles: ["ADMIN"],
};

test("crea una sesión cuando las credenciales son válidas", async () => {
  const result = await login(
    credentials,
    { ipAddress: null, userAgent: "Agente de prueba" },
    {
      createSessionToken: () => "token-opaco",
      hashSessionToken: (token) => {
        assert.equal(token, "token-opaco");
        return "hash-del-token";
      },
      findUserForAuthentication: async (email) => {
        assert.equal(email, credentials.email);
        return activeUser;
      },
      verifyPassword: async (password, hash) => {
        assert.equal(password, credentials.password);
        assert.equal(hash, activeUser.passwordHash);
        return true;
      },
      createSessionForSuccessfulLogin: async (sessionData) => {
        assert.equal(sessionData.tokenHash, "hash-del-token");
        assert.equal(sessionData.userId, activeUser.id);
        assert.equal(sessionData.userAgent, "Agente de prueba");
        return { id: "sesión-1", expiresAt: sessionData.expiresAt };
      },
    },
  );

  assert.equal(result.token, "token-opaco");
  assert.equal(result.user.id, activeUser.id);
  assert.equal(result.maxAgeSeconds, 28_800);
  assert.ok(!Object.hasOwn(result.user, "passwordHash"));
});

test("usa un hash ficticio cuando el usuario no existe", async () => {
  let verifiedHash;

  await assert.rejects(
    () =>
      login(credentials, {}, {
        findUserForAuthentication: async () => null,
        verifyPassword: async (_password, hash) => {
          verifiedHash = hash;
          return false;
        },
      }),
    (error) => error.code === "INVALID_CREDENTIALS" && error.status === 401,
  );

  assert.match(verifiedHash, /^scrypt\$/);
});

test("registra un intento fallido sin revelar qué credencial falló", async () => {
  let failedUserId;

  await assert.rejects(
    () =>
      login(credentials, {}, {
        findUserForAuthentication: async () => activeUser,
        verifyPassword: async () => false,
        recordFailedLogin: async (userId, attempts, minutes) => {
          failedUserId = userId;
          assert.equal(attempts, 5);
          assert.equal(minutes, 15);
        },
      }),
    (error) =>
      error.code === "INVALID_CREDENTIALS" &&
      !error.message.includes("correo existe"),
  );

  assert.equal(failedUserId, activeUser.id);
});

test("rechaza una cuenta bloqueada aunque la contraseña sea correcta", async () => {
  await assert.rejects(
    () =>
      login(credentials, {}, {
        findUserForAuthentication: async () => ({
          ...activeUser,
          lockedUntil: new Date(Date.now() + 60_000),
        }),
        verifyPassword: async () => true,
      }),
    (error) => error.code === "INVALID_CREDENTIALS",
  );
});

test("revoca la sesión al cerrar sesión", async () => {
  const actor = { sessionId: "sesión-1", userId: activeUser.id };
  let revokedArguments;

  await logout(actor, {
    revokeSession: async (...args) => {
      revokedArguments = args;
    },
  });

  assert.deepEqual(revokedArguments, [actor.sessionId, actor.userId]);
});
