import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { findCustomerByNormalizedRut } from "../repositories/customer-identity.js";
import { retryTransaction } from "../db/retry-transaction.js";
import { commerceCode, commerceCodeHash, verifyCommerceCode, isolatedCommerceMailbox } from "../utils/commerce-otp.js";
import { commercialError } from "../validations/customer-commercial-validation.js";
import { commerceProofDelivered } from "../repositories/customer-commerce-link-repository.js";
import { normalizeChileanRut } from "../utils/chilean-rut.js";
import { getTransactionalEmailConfig } from "../config/transactional-email.js";
import { processTransactionalEmailById } from "./transactional-email-service.js";
const key = id => `CUSTOMER_COMMERCE_OTP:${id}`;
const generic = () => commercialError("No fue posible verificar la identidad o el código. Revise los datos o solicite ayuda en la óptica.", "COMMERCE_VERIFICATION_FAILED", 409);
export async function requestCommerceCode(input, account = null) {
  const purpose = account ? "ORDER" : "REGISTRATION",
    id = randomUUID(),
    expiresAt = new Date(Date.now() + 600000),
    code = commerceCode();
  const synthetic = isolatedCommerceMailbox();
  if (!synthetic && getTransactionalEmailConfig().mode !== "live") commercialError("La verificación por correo no está disponible. Contacte a la óptica para verificar su identidad.", "COMMERCE_EMAIL_UNAVAILABLE", 503);
  let customer, email, order;
  if (account) {
    if (typeof input?.orderId !== "string" || !/^\d{1,18}$/.test(input.orderId)) commercialError("Indique el número del pedido anterior.");
    const cart = await prisma.store_carts.findFirst({
      where: {
        status: "CHECKED_OUT",
        sales: {
          sale_number: BigInt(input.orderId)
        }
      },
      include: {
        sales: true
      }
    });
    const current = await prisma.customer_accounts.findUnique({
      where: {
        id: account.id
      },
      include: {
        customers: true
      }
    });
    if (cart && current && cart.customer_account_id === null && normalizeChileanRut(cart.buyer_rut) === normalizeChileanRut(current.customers.rut) && cart.buyer_email?.toLowerCase() === current.email.toLowerCase() && cart.sales.customer_id === current.customer_id) {
      customer = current.customers;
      email = cart.buyer_email;
      order = cart.sales;
    }
  } else {
    const rut = normalizeChileanRut(input?.rut);
    if (!rut || typeof input?.email !== "string") commercialError("Ingrese RUT y correo válidos.");
    const row = await findCustomerByNormalizedRut(prisma, rut);
    if (row?.email?.toLowerCase() === input.email.trim().toLowerCase() && !(await prisma.customer_accounts.count({
      where: {
        OR: [{
          customer_id: row.id
        }, {
          email: input.email.trim().toLowerCase()
        }]
      }
    }))) {
      customer = row;
      email = row.email;
    }
  }
  if (!customer) return {
    challengeId: id,
    expiresAt,
    message: "Si los datos corresponden a un registro verificable, recibirá un código en el correo registrado."
  };
  if (synthetic && !email.endsWith(".invalid")) commercialError("El buzón aislado solo admite destinatarios sintéticos.", "COMMERCE_EMAIL_UNAVAILABLE", 503);
  const outbox = await retryTransaction(prisma, async c => {
    await c.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"commerce-challenge:" + customer.id + purpose},0))::text`;
    const recent = await c.customer_commerce_challenges.findFirst({
      where: {
        customer_id: customer.id,
        purpose,
        created_at: {
          gt: new Date(Date.now() - 60000)
        }
      }
    });
    if (recent) commercialError("Espere un minuto antes de solicitar otro código.", "COMMERCE_CODE_COOLDOWN", 429);
    await c.customer_commerce_challenges.updateMany({
      where: {
        customer_id: customer.id,
        purpose,
        consumed_at: null,
        ...(account ? {
          account_id: account.id
        } : {})
      },
      data: {
        consumed_at: new Date()
      }
    });
    await c.customer_commerce_challenges.create({
      data: {
        id,
        customer_id: customer.id,
        account_id: account?.id ?? null,
        sale_id: order?.id ?? null,
        purpose,
        email,
        code_hash: commerceCodeHash(id, code),
        expires_at: expiresAt
      }
    });
    return c.transactional_email_outbox.create({
      data: {
        template_code: "CUSTOMER_COMMERCE_OTP",
        recipient_email: email,
        payload: {
          challengeId: id,
          code
        },
        deduplication_key: key(id),
        account_id: account?.id ?? null,
        sale_id: order?.id ?? null
      }
    });
  });
  if (synthetic) {
    await prisma.customer_commerce_challenges.update({
      where: {
        id
      },
      data: {
        delivered_at: new Date()
      }
    });
  } else {
    const delivered = await processTransactionalEmailById(outbox.id);
    if (delivered.sent !== 1) commercialError("No se pudo entregar el código. Inténtelo nuevamente más tarde.", "COMMERCE_EMAIL_UNAVAILABLE", 503);
    await prisma.customer_commerce_challenges.update({
      where: {
        id
      },
      data: {
        delivered_at: new Date()
      }
    });
  }
  return {
    challengeId: id,
    expiresAt,
    message: "Si los datos corresponden a un registro verificable, recibirá un código en el correo registrado."
  };
}
export async function confirmOrderLink(input, account) {
  if (!input || typeof input.challengeId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.challengeId) || !/^\d{6}$/.test(input.code ?? "")) generic();
  const result = await retryTransaction(prisma, async c => {
    await c.$queryRaw`SELECT id FROM customer_commerce_challenges WHERE id=${input.challengeId}::uuid FOR UPDATE`;
    const proof = await c.customer_commerce_challenges.findUnique({
      where: {
        id: input.challengeId
      }
    });
    if (!proof || proof.account_id !== account.id || proof.purpose !== "ORDER" || proof.consumed_at || proof.attempt_count >= 5 || proof.expires_at <= new Date() || !(await commerceProofDelivered(c, proof))) return false;
    await c.customer_commerce_challenges.update({
      where: {
        id: proof.id
      },
      data: {
        attempt_count: {
          increment: 1
        }
      }
    });
    if (!verifyCommerceCode(proof.id, input.code, proof.code_hash)) return false;
    const [current, cart, existing] = await Promise.all([c.customer_accounts.findUnique({
      where: {
        id: account.id
      },
      include: {
        customers: true
      }
    }), c.store_carts.findUnique({
      where: {
        sale_id: proof.sale_id
      }
    }), c.customer_order_links.findUnique({
      where: {
        sale_id: proof.sale_id
      }
    })]);
    if (!current || current.customer_id !== proof.customer_id || current.email.toLowerCase() !== proof.email.toLowerCase() || !cart || normalizeChileanRut(cart.buyer_rut) !== normalizeChileanRut(current.customers.rut) || cart.buyer_email?.toLowerCase() !== current.email.toLowerCase() || cart.customer_account_id && cart.customer_account_id !== account.id || existing && existing.account_id !== account.id) return false;
    if (!existing) await c.customer_order_links.create({
      data: {
        sale_id: proof.sale_id,
        account_id: account.id,
        challenge_id: proof.id
      }
    });
    await c.customer_commerce_challenges.update({
      where: {
        id: proof.id
      },
      data: {
        consumed_at: new Date()
      }
    });
    await c.customer_accounts.update({
      where: {
        id: account.id
      },
      data: {
        email_verified_at: new Date()
      }
    });
    return true;
  });
  if (!result) generic();
  return {
    linked: true
  };
}
