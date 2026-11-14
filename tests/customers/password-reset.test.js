import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";
import { prisma } from "../../src/db/prisma.js";
import { getTransactionalEmailEligibility, mapEmail, sanitizeTransactionalEmailPayload } from "../../src/repositories/transactional-email-repository.js";
import { loginStoreAccount } from "../../src/services/store-account-service.js";
import { preparePasswordReset, resetStorePassword } from "../../src/services/store-password-reset-service.js";
import { evaluation, requireEvaluationDatabase } from "../evaluation-data.js";

requireEvaluationDatabase(process.env.DATABASE_URL, process.env.STORE_E2E_SCHEMA);

test("la recuperación cambia la contraseña una sola vez, cierra sesiones y protege el código", async () => {
  const email = "recuperacion-sintetica@example.invalid";
  const password = "Clave-nueva-de-evaluacion-2026!";
  const invalid = (error) => error.code === "PASSWORD_RESET_INVALID";
  try {
    const customer = await prisma.customers.create({ data: { first_names: "Recuperación sintética", email } });
    const account = await prisma.customer_accounts.create({
      data: { customer_id: customer.id, email, password_hash: await hashPassword(evaluation.password) },
    });
    const session = await loginStoreAccount({ email, password: evaluation.password });
    const scheduled = [];
    let emailId;
    const dependencies = {
      getEmailConfig: () => ({ mode: "live" }),
      sendEmail: async (id) => { emailId = id; },
    };
    const schedule = (operation) => scheduled.push(operation);
    const unknown = preparePasswordReset("sin-cuenta@example.invalid", schedule, dependencies);
    const { challengeId } = preparePasswordReset(email, schedule, dependencies);
    assert.deepEqual(Object.keys(unknown), ["challengeId"]);
    await scheduled.shift()();
    assert.equal(emailId, undefined);
    await scheduled.shift()();

    const mail = await prisma.transactional_email_outbox.findUniqueOrThrow({ where: { id: emailId } });
    const code = mail.payload.code;
    const workerEmail = mapEmail(mail, { includeOtpCode: true });
    assert.equal(mapEmail(mail).payload.code, undefined);
    assert.equal(sanitizeTransactionalEmailPayload(mail.template_code, mail.payload, "SENT").code, undefined);
    assert.equal((await getTransactionalEmailEligibility({ ...workerEmail, deliveryMode: "test" })).eligible, false);
    assert.equal((await getTransactionalEmailEligibility({ ...workerEmail, deliveryMode: "live" })).eligible, true);
    await assert.rejects(() => resetStorePassword({ challengeId, code: code === "123456" ? "654321" : "123456", password }), invalid);
    await assert.rejects(() => resetStorePassword({ challengeId: unknown.challengeId, code, password }), invalid);

    const results = await Promise.allSettled([
      resetStorePassword({ challengeId, code, password }),
      resetStorePassword({ challengeId, code, password }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(invalid(results.find((result) => result.status === "rejected").reason));
    const updated = await prisma.customer_accounts.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(await verifyPassword(password, updated.password_hash), true);
    assert.equal(await verifyPassword(evaluation.password, updated.password_hash), false);
    assert.ok((await prisma.customer_account_sessions.findUniqueOrThrow({ where: { id: session.session.id } })).revoked_at);
    await loginStoreAccount({ email, password });
  } finally {
    await prisma.$disconnect();
  }
});
