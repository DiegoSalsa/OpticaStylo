import { sendTransactionalEmail } from "../integrations/email/transactional-email-sender.js";
import {
  claimTransactionalEmail,
  listDuePaymentConfirmationKeys,
  markTransactionalEmailFailed,
  markTransactionalEmailSent,
} from "../repositories/transactional-email-repository.js";

export async function deliverTransactionalEmail(deduplicationKey, dependencies = {}) {
  const claim = await (
    dependencies.claimEmail ?? claimTransactionalEmail
  )(deduplicationKey);
  if (!claim.claimed) {
    return { reason: claim.reason, status: claim.email?.status ?? "NOT_FOUND" };
  }

  try {
    const delivery = await (
      dependencies.sendEmail ?? sendTransactionalEmail
    )(claim.email, dependencies.senderDependencies ?? {});
    await (dependencies.markSent ?? markTransactionalEmailSent)(claim.email.id);
    return delivery;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fallo de envio desconocido.";
    await (dependencies.markFailed ?? markTransactionalEmailFailed)(
      claim.email.id,
      message,
      claim.email.attemptCount,
    );
    return { error: message, status: "FAILED" };
  }
}

export async function deliverDuePaymentConfirmations(dependencies = {}) {
  const keys = await (
    dependencies.listDueKeys ?? listDuePaymentConfirmationKeys
  )(dependencies.limit ?? 25);
  const results = [];
  for (const key of keys) {
    results.push({
      key,
      result: await deliverTransactionalEmail(key, dependencies),
    });
  }
  return results;
}
