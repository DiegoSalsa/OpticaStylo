import { prisma } from "../db/prisma.js";
import { normalizeChileanRut } from "../utils/chilean-rut.js";
import { verifyCommerceCode } from "../utils/commerce-otp.js";
export async function commerceProofDelivered(client, proof) {
  if (proof.delivered_at) return true;
  const email = await client.transactional_email_outbox.findUnique({
    where: {
      deduplication_key: "CUSTOMER_COMMERCE_OTP:" + proof.id
    },
    select: {
      status: true,
      delivery_mode: true,
      effective_recipient_email: true
    }
  });
  return !!email && ["SENT", "DELIVERED"].includes(email.status) && email.delivery_mode === "live" && email.effective_recipient_email?.toLowerCase() === proof.email.toLowerCase();
}
export async function consumeRegistrationProof(client, input, accountData) {
  const proof = await client.customer_commerce_challenges.findUnique({
    where: {
      id: input.challengeId ?? "00000000-0000-4000-8000-000000000000"
    }
  });
  if (!proof || proof.purpose !== "REGISTRATION" || proof.consumed_at || proof.expires_at <= new Date() || proof.attempt_count > 5 || proof.email.toLowerCase() !== accountData.email || !(await commerceProofDelivered(client, proof))) return null;
  const customer = await client.customers.findUnique({
    where: {
      id: proof.customer_id
    }
  });
  if (!customer || normalizeChileanRut(customer.rut) !== accountData.rut || customer.email?.toLowerCase() !== accountData.email) return null;
  if (!verifyCommerceCode(proof.id, String(input.verificationCode ?? ""), proof.code_hash)) return null;
  await client.customer_commerce_challenges.update({
    where: {
      id: proof.id
    },
    data: {
      consumed_at: new Date()
    }
  });
  return customer;
}
export async function recordRegistrationAttempt(input) {
  if (typeof input?.challengeId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.challengeId)) return false;
  const result = await prisma.customer_commerce_challenges.updateMany({
    where: {
      id: input.challengeId,
      purpose: "REGISTRATION",
      consumed_at: null,
      attempt_count: {
        lt: 5
      },
      expires_at: {
        gt: new Date()
      }
    },
    data: {
      attempt_count: {
        increment: 1
      }
    }
  });
  return result.count === 1;
}
