import assert from "node:assert/strict";
import test from "node:test";
import { decryptPasswordResetCode, encryptPasswordResetCode, PasswordResetEncryptionConfigError } from "../../src/utils/store-password-reset-code.js";

test("el cifrado autentica el código, la clave y el desafío", () => {
  const env = { CUSTOMER_PASSWORD_RESET_ENCRYPTION_KEY: "f1".repeat(32) };
  const protectedCode = encryptPasswordResetCode("solicitud-a", "012345", env);
  assert.equal(decryptPasswordResetCode("solicitud-a", protectedCode, env), "012345");
  assert.notEqual(encryptPasswordResetCode("solicitud-a", "012345", env), protectedCode);
  assert.throws(() => decryptPasswordResetCode("solicitud-b", protectedCode, env));
  assert.throws(() => decryptPasswordResetCode("solicitud-a", protectedCode, { CUSTOMER_PASSWORD_RESET_ENCRYPTION_KEY: "0a".repeat(32) }));
  const modified = Buffer.from(protectedCode, "base64url");
  modified[28] ^= 1;
  assert.throws(() => decryptPasswordResetCode("solicitud-a", modified.toString("base64url"), env));
  assert.throws(() => encryptPasswordResetCode("solicitud-a", "012345", {}), PasswordResetEncryptionConfigError);
});
