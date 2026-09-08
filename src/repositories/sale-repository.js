import { prisma } from "../db/prisma.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";
import {
  consumeDiscountAuthorizationWithClient,
  lockDiscountAuthorizationWithClient,
} from "./discount-authorization-grant-repository.js";

const saleInclude = {
  customers: true,
  external_prescriptions: true,
  optical_prescriptions: { include: { clinical_encounters: { include: { patients: true } } } },
  patients: true,
  sale_items: { orderBy: { position: "asc" } },
  sale_optical_additions: { orderBy: { position: "asc" } },
  sale_payments: {
    include: { sale_receipts: { orderBy: [{ issued_at: "desc" }, { receipt_number: "desc" }] } },
    orderBy: [{ paid_at: "asc" }, { id: "asc" }],
  },
  sale_receipts: { orderBy: [{ issued_at: "desc" }, { receipt_number: "desc" }] },
  store_carts: true,
  users_sales_discount_authorized_byTousers: true,
};

function mapReceipt(row) {
  return row ? {
    emailError: row.email_error, emailProviderId: row.email_provider_id,
    emailStatus: row.email_status, emailedTo: row.emailed_to, id: row.id,
    issuedAt: row.issued_at, paymentId: row.payment_id, payload: row.payload,
    receiptNumber: Number(row.receipt_number), saleId: row.sale_id, type: row.receipt_type,
  } : null;
}

function mapSale(row, details = true) {
  if (!row) return null;
  const cart = row.store_carts;
  const customer = row.customers;
  const authorizer = row.users_sales_discount_authorized_byTousers;
  const paidCents = row.sale_payments.reduce((sum, payment) => sum + Number(payment.amount_cents), 0);
  const totalCents = Number(row.total_cents);
  const latestReceipt = row.sale_receipts[0];
  const prescription = row.optical_prescriptions;
  const base = {
    balanceCents: totalCents - paidCents, cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at, createdAt: row.created_at,
    customer: row.customer_id ? {
      email: cart?.buyer_email ?? customer?.email,
      firstNames: cart?.buyer_first_names ?? customer?.first_names,
      id: row.customer_id, lastNames: cart?.buyer_last_names ?? customer?.last_names,
      phone: cart?.buyer_phone ?? customer?.phone, rut: cart?.buyer_rut ?? customer?.rut,
    } : null,
    discountCents: Number(row.discount_cents ?? 0), discountReason: row.discount_reason,
    discount: Number(row.discount_cents) > 0 ? {
      amountCents: Number(row.discount_cents), authorizedAt: row.discount_authorized_at,
      authorizedBy: authorizer ? { firstName: authorizer.first_name, id: authorizer.id, lastName: authorizer.last_name } : null,
      reason: row.discount_reason,
    } : null,
    externalPrescription: row.external_prescription_id ? {
      id: row.external_prescription_id, source: row.external_prescriptions?.source,
      status: row.external_prescriptions?.status,
    } : null,
    fulfillment: row.fulfillment_method ? {
      address: row.delivery_address, city: row.delivery_city,
      method: row.fulfillment_method, notes: row.delivery_notes, region: row.delivery_region,
    } : null,
    id: row.id, origin: row.origin, paidCents, paymentMethod: row.payment_method,
    patient: row.patients ? {
      firstNames: row.patients.first_names, id: row.patients.id,
      lastNames: row.patients.last_names, rut: row.patients.rut,
    } : null,
    prescription: prescription ? {
      id: prescription.id,
      patient: {
        firstNames: prescription.clinical_encounters.patients.first_names,
        id: prescription.clinical_encounters.patient_id,
        lastNames: prescription.clinical_encounters.patients.last_names,
        rut: prescription.clinical_encounters.patients.rut,
      },
      status: prescription.status, version: prescription.version,
    } : null,
    quotationValidUntil: row.quotation_valid_until,
    receipt: latestReceipt ? {
      emailStatus: latestReceipt.email_status, emailedTo: latestReceipt.emailed_to,
      id: latestReceipt.id, issuedAt: latestReceipt.issued_at,
      paymentId: latestReceipt.payment_id, receiptNumber: Number(latestReceipt.receipt_number),
      type: latestReceipt.receipt_type,
    } : null,
    saleNumber: Number(row.sale_number), shippingFeeCents: Number(row.shipping_fee_cents),
    shippingQuoteSource: row.shipping_quote_source, status: row.status,
    subtotalCents: Number(row.subtotal_cents), totalCents, updatedAt: row.updated_at,
  };
  if (!details) return base;
  return {
    ...base,
    items: row.sale_items.map((item) => ({
      category: item.product_category, id: item.id,
      lineTotalCents: Number(item.line_total_cents ?? Number(item.unit_price_cents) * item.quantity),
      mount: item.mount_source ? { frameProductId: item.mounted_on_product_id, source: item.mount_source } : null,
      name: item.product_name, position: item.position, productId: item.product_id,
      quantity: item.quantity, requiresPrescription: item.requires_prescription,
      sku: item.product_sku, unitPriceCents: Number(item.unit_price_cents),
    })),
    opticalAdditions: row.sale_optical_additions.map((addition) => ({
      description: addition.description, id: addition.id,
      lineTotalCents: Number(addition.line_total_cents ?? Number(addition.unit_price_cents) * addition.quantity),
      name: addition.name, position: addition.position, quantity: addition.quantity,
      unitPriceCents: Number(addition.unit_price_cents),
    })),
    payments: row.sale_payments.map((payment) => ({
      amountCents: Number(payment.amount_cents),
      cashReceivedCents: payment.cash_received_cents == null ? null : Number(payment.cash_received_cents),
      changeCents: payment.change_cents == null ? null : Number(payment.change_cents),
      id: payment.id, paidAt: payment.paid_at, paymentMethod: payment.payment_method,
      providerAttemptId: payment.provider_attempt_id, receivedBy: payment.received_by,
      receipt: payment.sale_receipts[0] ? {
        emailStatus: payment.sale_receipts[0].email_status, id: payment.sale_receipts[0].id,
        issuedAt: payment.sale_receipts[0].issued_at,
        receiptNumber: Number(payment.sale_receipts[0].receipt_number),
        type: payment.sale_receipts[0].receipt_type,
      } : null,
      reference: payment.reference, source: payment.source,
    })),
  };
}

async function findSaleWithClient(client, saleId) {
  return mapSale(await client.sales.findUnique({ include: saleInclude, where: { id: saleId } }));
}

export async function findSaleById(saleId) {
  return findSaleWithClient(prisma, saleId);
}

async function loadDraftReferences(client, draft) {
  if (draft.customerId && !(await client.customers.findUnique({ select: { id: true }, where: { id: draft.customerId } }))) {
    return { reason: "CUSTOMER_NOT_FOUND" };
  }
  if (draft.patientId && !(await client.patients.findUnique({ select: { id: true }, where: { id: draft.patientId } }))) {
    return { reason: "PATIENT_NOT_FOUND" };
  }
  const productIds = draft.items.map((item) => item.productId);
  const products = await client.products.findMany({ where: { id: { in: productIds } } });
  if (products.length !== productIds.length) return { reason: "PRODUCT_NOT_FOUND" };
  if (products.some((product) => !product.is_active)) return { reason: "PRODUCT_INACTIVE" };
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const item of draft.items) {
    const product = byId.get(item.productId);
    if (product.category !== "PRESCRIPTION_LENS") {
      if (item.mount) return { reason: "UNEXPECTED_LENS_MOUNT" };
    } else if (!item.mount) return { reason: "LENS_MOUNT_REQUIRED" };
    else if (item.mount.source !== "CUSTOMER_FRAME"
      && byId.get(item.mount.frameProductId)?.category !== "FRAME") return { reason: "INVALID_LENS_MOUNT" };
  }
  if (draft.prescriptionId) {
    const prescription = await client.optical_prescriptions.findUnique({
      include: { clinical_encounters: true }, where: { id: draft.prescriptionId },
    });
    if (!prescription) return { reason: "PRESCRIPTION_NOT_FOUND" };
    if (prescription.status !== "ACTIVE" || prescription.clinical_encounters.status !== "FINALIZED") return { reason: "PRESCRIPTION_NOT_USABLE" };
    if (prescription.clinical_encounters.patient_id !== draft.patientId) return { reason: "PRESCRIPTION_PATIENT_MISMATCH" };
  }
  if (draft.externalPrescriptionId) {
    const external = await client.external_prescriptions.findUnique({ where: { id: draft.externalPrescriptionId } });
    if (!external) return { reason: "EXTERNAL_PRESCRIPTION_NOT_FOUND" };
    if (external.status !== "READY" || external.customer_id !== draft.customerId || external.patient_id !== draft.patientId) {
      return { reason: "EXTERNAL_PRESCRIPTION_NOT_USABLE" };
    }
  }
  const lines = draft.items.map((item, index) => ({ ...byId.get(item.productId), mount: item.mount, position: index + 1, quantity: item.quantity }));
  const productSubtotalCents = lines.reduce((sum, line) => sum + Number(line.unit_price_cents) * line.quantity, 0);
  const additionsSubtotalCents = draft.opticalAdditions.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const subtotalCents = productSubtotalCents + additionsSubtotalCents;
  const discountCents = draft.discount?.amountCents ?? 0;
  if (discountCents >= subtotalCents) return { reason: "DISCOUNT_EXCEEDS_SUBTOTAL" };
  return { additionsSubtotalCents, discountCents, lines, productSubtotalCents, reason: null, subtotalCents, totalCents: subtotalCents - discountCents };
}

function itemData(saleId, lines) {
  return lines.map((line) => ({
    mount_source: line.mount?.source ?? null, mounted_on_product_id: line.mount?.frameProductId ?? null,
    position: line.position, product_category: line.category, product_id: line.id,
    product_name: line.name, product_sku: line.sku, quantity: line.quantity,
    requires_prescription: line.requires_prescription, sale_id: saleId,
    unit_price_cents: line.unit_price_cents,
  }));
}

function additionData(saleId, additions) {
  return additions.map((item, index) => ({
    description: item.description, name: item.name, position: index + 1,
    quantity: item.quantity, sale_id: saleId, unit_price_cents: item.unitPriceCents,
  }));
}

async function insertSaleEvent(client, saleId, eventType, actorUserId, { details = null, newStatus = null, previousStatus = null } = {}) {
  await client.sale_events.create({ data: {
    details: details == null ? null : JSON.stringify(details), event_type: eventType,
    new_status: newStatus, performed_by: actorUserId, previous_status: previousStatus, sale_id: saleId,
  } });
}

async function authorizeDiscount(client, draft, actorUserId) {
  if (!draft.discount) return draft;
  const authorizedBy = await lockDiscountAuthorizationWithClient(client, { ...draft.discount, requestedBy: actorUserId });
  return authorizedBy ? { ...draft, discount: { ...draft.discount, authorizedAt: new Date(), authorizedBy } } : null;
}

async function recordDiscount(client, saleId, draft, actorUserId, status = "QUOTATION") {
  if (!draft.discount) return;
  await insertSaleEvent(client, saleId, "DISCOUNT_AUTHORIZED", actorUserId, {
    details: { amountCents: draft.discount.amountCents, authorizedBy: draft.discount.authorizedBy, reason: draft.discount.reason },
    newStatus: status, previousStatus: status,
  });
  await consumeDiscountAuthorizationWithClient(client, draft.discount.authorizationId, saleId);
}

export async function createSale(draft, actorUserId, options = {}) {
  return prisma.$transaction(async (client) => {
    if (options.requestKey) {
      const existing = await client.sales.findFirst({ where: { created_by: actorUserId, request_key: options.requestKey } });
      if (existing) return { reason: null, sale: await findSaleWithClient(client, existing.id) };
    }
    const references = await loadDraftReferences(client, draft);
    if (references.reason) return { reason: references.reason, sale: null };
    const authorized = await authorizeDiscount(client, draft, actorUserId);
    if (!authorized) return { reason: "DISCOUNT_AUTHORIZATION_INVALID", sale: null };
    const status = options.status === "PENDING" ? "PENDING" : "QUOTATION";
    const sale = await client.sales.create({ data: {
      created_by: actorUserId, customer_id: draft.customerId,
      discount_authorized_at: authorized.discount?.authorizedAt ?? null,
      discount_authorized_by: authorized.discount?.authorizedBy ?? null,
      discount_cents: references.discountCents,
      discount_reason: authorized.discount?.reason ?? null,
      external_prescription_id: draft.externalPrescriptionId, patient_id: draft.patientId,
      prescription_id: draft.prescriptionId,
      quotation_valid_until: status === "QUOTATION" ? new Date(Date.now() + 30 * 86_400_000) : null,
      request_key: options.requestKey ?? null, status, subtotal_cents: references.subtotalCents,
      total_cents: references.totalCents, updated_by: actorUserId,
    } });
    await client.sale_items.createMany({ data: itemData(sale.id, references.lines) });
    if (authorized.opticalAdditions.length) await client.sale_optical_additions.createMany({ data: additionData(sale.id, authorized.opticalAdditions) });
    await insertSaleEvent(client, sale.id, "CREATED", actorUserId, {
      details: {
        additionsSubtotalCents: references.additionsSubtotalCents,
        discountCents: references.discountCents, discountReason: authorized.discount?.reason ?? null,
        productSubtotalCents: references.productSubtotalCents,
        subtotalCents: references.subtotalCents, totalCents: references.totalCents,
      }, newStatus: status,
    });
    await recordDiscount(client, sale.id, authorized, actorUserId, status);
    return { reason: null, sale: await findSaleWithClient(client, sale.id) };
  }, { isolationLevel: "Serializable" });
}

export async function updateSaleDraft(saleId, draft, actorUserId) {
  return prisma.$transaction(async (client) => {
    const sale = await client.sales.findUnique({ where: { id: saleId } });
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (sale.status !== "QUOTATION") return { reason: "SALE_NOT_EDITABLE", sale: null };
    let references = await loadDraftReferences(client, draft);
    if (references.reason) return { reason: references.reason, sale: null };
    const additions = await client.sale_optical_additions.findMany({ where: { sale_id: saleId } });
    const preserved = additions.reduce((sum, item) => sum + Number(item.line_total_cents ?? Number(item.unit_price_cents) * item.quantity), 0);
    if (preserved > 0) {
      const subtotalCents = references.productSubtotalCents + preserved;
      if (references.discountCents >= subtotalCents) return { reason: "DISCOUNT_EXCEEDS_SUBTOTAL", sale: null };
      references = { ...references, additionsSubtotalCents: preserved, subtotalCents, totalCents: subtotalCents - references.discountCents };
    }
    const authorized = await authorizeDiscount(client, draft, actorUserId);
    if (!authorized) return { reason: "DISCOUNT_AUTHORIZATION_INVALID", sale: null };
    await client.sale_items.deleteMany({ where: { sale_id: saleId } });
    await client.sales.update({ data: {
      customer_id: authorized.customerId, discount_authorized_at: authorized.discount?.authorizedAt ?? null,
      discount_authorized_by: authorized.discount?.authorizedBy ?? null,
      discount_cents: references.discountCents, discount_reason: authorized.discount?.reason ?? null,
      external_prescription_id: authorized.externalPrescriptionId, patient_id: authorized.patientId,
      prescription_id: authorized.prescriptionId, subtotal_cents: references.subtotalCents,
      total_cents: references.totalCents, updated_by: actorUserId,
    }, where: { id: saleId } });
    await client.sale_items.createMany({ data: itemData(saleId, references.lines) });
    await insertSaleEvent(client, saleId, "UPDATED", actorUserId, {
      details: { discountCents: references.discountCents, discountReason: authorized.discount?.reason ?? null, subtotalCents: references.subtotalCents, totalCents: references.totalCents },
      newStatus: "QUOTATION", previousStatus: "QUOTATION",
    });
    await recordDiscount(client, saleId, authorized, actorUserId);
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  }, { isolationLevel: "Serializable" });
}

async function enqueueOrder(client, sale) {
  if (!sale.customers?.email) return;
  const key = transactionalEmailDeduplicationKey("ORDER_CONFIRMED", sale.id);
  await client.transactional_email_outbox.upsert({
    create: {
      deduplication_key: key,
      payload: { saleNumber: Number(sale.sale_number), totalCents: Number(sale.total_cents) },
      recipient_email: sale.customers.email, sale_id: sale.id, template_code: "ORDER_CONFIRMED",
    }, update: {}, where: { deduplication_key: key },
  });
}

export async function confirmSale(saleId, actorUserId) {
  return prisma.$transaction(async (client) => {
    const sale = await client.sales.findUnique({
      include: {
        customers: true, external_prescriptions: true,
        optical_prescriptions: { include: { clinical_encounters: true } },
        sale_items: { include: { products_sale_items_product_idToproducts: true } },
      }, where: { id: saleId },
    });
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (sale.status !== "QUOTATION") return { reason: "SALE_NOT_CONFIRMABLE", sale: null };
    if (sale.quotation_valid_until && sale.quotation_valid_until < new Date()) return { reason: "QUOTATION_EXPIRED", sale: null };
    if (sale.sale_items.some((item) => !item.products_sale_items_product_idToproducts.is_active)) return { reason: "PRODUCT_INACTIVE", sale: null };
    if (sale.optical_prescriptions) {
      if (sale.optical_prescriptions.status !== "ACTIVE" || sale.optical_prescriptions.clinical_encounters.status !== "FINALIZED") return { reason: "PRESCRIPTION_NOT_USABLE", sale: null };
      if (sale.optical_prescriptions.clinical_encounters.patient_id !== sale.patient_id) return { reason: "PRESCRIPTION_PATIENT_MISMATCH", sale: null };
    }
    if (sale.external_prescriptions && (sale.external_prescriptions.status !== "READY"
      || sale.external_prescriptions.customer_id !== sale.customer_id
      || sale.external_prescriptions.patient_id !== sale.patient_id)) return { reason: "EXTERNAL_PRESCRIPTION_NOT_USABLE", sale: null };
    await client.sales.update({ data: { status: "PENDING", updated_by: actorUserId }, where: { id: saleId } });
    await insertSaleEvent(client, saleId, "STATUS_CHANGED", actorUserId, { newStatus: "PENDING", previousStatus: "QUOTATION" });
    await enqueueOrder(client, sale);
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  }, { isolationLevel: "Serializable" });
}

export async function registerSalePayment(saleId, payment, actorUserId, options = {}) {
  return prisma.$transaction(async (client) => {
    const sale = await client.sales.findUnique({ include: { customers: true, sale_payments: true }, where: { id: saleId } });
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (options.requestKey && sale.sale_payments.some((item) => item.request_key === options.requestKey)) return { reason: null, sale: await findSaleWithClient(client, saleId) };
    if (sale.status !== "PENDING") return { reason: "SALE_NOT_PAYABLE", sale: null };
    if (sale.payment_method && sale.payment_method !== payment.paymentMethod) return { reason: "PAYMENT_METHOD_MISMATCH", sale: null };
    if (payment.paymentMethod === "CASH" && !(await client.cash_register_sessions.findFirst({ where: { status: "OPEN" } }))) return { reason: "CASH_REGISTER_CLOSED", sale: null };
    if (await client.payment_attempts.findFirst({ where: {
      expires_at: { gt: new Date() }, sale_id: saleId, status: { in: ["CREATED", "PENDING"] },
    } })) return { reason: "PAYMENT_ATTEMPT_ACTIVE", sale: null };
    const paidCents = sale.sale_payments.reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const totalCents = Number(sale.total_cents);
    if (payment.amountCents > totalCents - paidCents) return { reason: "PAYMENT_EXCEEDS_BALANCE", sale: null };
    const created = await client.sale_payments.create({ data: {
      amount_cents: payment.amountCents, cash_received_cents: payment.cashReceivedCents,
      change_cents: payment.changeCents, payment_method: payment.paymentMethod,
      received_by: actorUserId, reference: payment.reference,
      request_key: options.requestKey ?? null, sale_id: saleId,
    } });
    const newStatus = paidCents + payment.amountCents === totalCents ? "PAID" : "PENDING";
    await client.sales.update({ data: { payment_method: payment.paymentMethod, status: newStatus, updated_by: actorUserId }, where: { id: saleId } });
    await insertSaleEvent(client, saleId, "PAYMENT_REGISTERED", actorUserId, {
      details: { amountCents: payment.amountCents, cashReceivedCents: payment.cashReceivedCents, changeCents: payment.changeCents, paymentMethod: payment.paymentMethod },
      newStatus, previousStatus: "PENDING",
    });
    if (sale.customers?.email) {
      const key = transactionalEmailDeduplicationKey("PAYMENT_CONFIRMED", created.id);
      await client.transactional_email_outbox.upsert({
        create: {
          deduplication_key: key,
          payload: { amountCents: payment.amountCents, saleNumber: Number(sale.sale_number) },
          payment_id: created.id, recipient_email: sale.customers.email,
          sale_id: saleId, template_code: "PAYMENT_CONFIRMED",
        }, update: {}, where: { deduplication_key: key },
      });
    }
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  }, { isolationLevel: "Serializable" });
}

const ALLOWED_TRANSITIONS = Object.freeze({ PAID: ["IN_PREPARATION"], IN_PREPARATION: ["READY"], READY: ["DELIVERED"] });

export async function changeSaleStatus(saleId, change, actorUserId, changedAt) {
  return prisma.$transaction(async (client) => {
    const current = await client.sales.findUnique({ include: { sale_payments: true }, where: { id: saleId } });
    if (!current) return { reason: "SALE_NOT_FOUND", sale: null };
    if (change.status === "CANCELLED") {
      if (!["QUOTATION", "PENDING"].includes(current.status)) return { reason: "SALE_NOT_CANCELLABLE", sale: null };
      if (current.sale_payments.length) return { reason: "SALE_HAS_PAYMENTS", sale: null };
      await client.sales.update({ data: {
        cancellation_reason: change.cancellationReason, cancelled_at: changedAt,
        status: "CANCELLED", updated_by: actorUserId,
      }, where: { id: saleId } });
      await insertSaleEvent(client, saleId, "CANCELLED", actorUserId, {
        details: { reason: change.cancellationReason }, newStatus: "CANCELLED", previousStatus: current.status,
      });
    } else {
      if (!(ALLOWED_TRANSITIONS[current.status] ?? []).includes(change.status)) return { reason: "INVALID_STATUS_TRANSITION", sale: null };
      await client.sales.update({ data: { status: change.status, updated_by: actorUserId }, where: { id: saleId } });
      await insertSaleEvent(client, saleId, "STATUS_CHANGED", actorUserId, { newStatus: change.status, previousStatus: current.status });
    }
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  }, { isolationLevel: "Serializable" });
}

export async function listSales({ customerId, page, pageSize, status }) {
  const where = { ...(customerId ? { customer_id: customerId } : {}), ...(status ? { status } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.sales.findMany({
      include: saleInclude, orderBy: [{ created_at: "desc" }, { sale_number: "desc" }],
      skip: (page - 1) * pageSize, take: pageSize, where,
    }),
    prisma.sales.count({ where }),
  ]);
  return { items: items.map((row) => mapSale(row, false)), page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0 };
}

export async function listSaleEvents(saleId) {
  return (await prisma.sale_events.findMany({
    orderBy: [{ created_at: "asc" }, { id: "asc" }], where: { sale_id: saleId },
  })).map((row) => ({
    createdAt: row.created_at,
    details: typeof row.details === "string" ? JSON.parse(row.details) : row.details,
    eventType: row.event_type, id: Number(row.id), newStatus: row.new_status,
    performedBy: row.performed_by, previousStatus: row.previous_status,
  }));
}

export function buildPaymentReceiptSnapshot(sale, paymentId) {
  if (!paymentId) return null;
  const index = sale.payments.findIndex((payment) => payment.id === paymentId);
  if (index === -1) return null;
  const payments = sale.payments.slice(0, index + 1);
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return { balanceCents: sale.totalCents - paidCents, paidCents, payment: payments.at(-1), payments, type: "PAYMENT" };
}

async function enqueueReceipt(client, receipt, emailedTo, saleId, paymentId, templateCode) {
  if (!emailedTo) return;
  const key = transactionalEmailDeduplicationKey(templateCode, receipt.id);
  await client.transactional_email_outbox.upsert({
    create: {
      deduplication_key: key, payload: {}, payment_id: paymentId,
      receipt_id: receipt.id, recipient_email: emailedTo, sale_id: saleId,
      template_code: templateCode,
    }, update: {}, where: { deduplication_key: key },
  });
}

export async function issueSaleReceipt(saleId, request, actorUserId) {
  return prisma.$transaction(async (client) => {
    const locked = await client.sales.findUnique({ where: { id: saleId } });
    if (!locked) return { reason: "SALE_NOT_FOUND", receipt: null };
    if (["QUOTATION", "CANCELLED"].includes(locked.status)) return { reason: "RECEIPT_NOT_AVAILABLE", receipt: null };
    const sale = await findSaleWithClient(client, saleId);
    const snapshot = buildPaymentReceiptSnapshot(sale, request.paymentId);
    if (request.paymentId && !snapshot) return { reason: "PAYMENT_NOT_FOUND", receipt: null };
    if (!snapshot && sale.status === "PENDING") return { reason: "RECEIPT_PAYMENT_REQUIRED", receipt: null };
    const receiptType = snapshot?.type ?? "FINAL";
    const existing = await client.sale_receipts.findFirst({
      orderBy: [{ issued_at: "desc" }, { receipt_number: "desc" }],
      where: { sale_id: saleId, ...(request.paymentId ? { payment_id: request.paymentId } : { receipt_type: "FINAL" }) },
    });
    if (existing) return { reason: null, receipt: mapReceipt(existing) };
    const emailedTo = request.email ?? sale.customer?.email ?? null;
    const paidCents = snapshot?.paidCents ?? sale.paidCents;
    const balanceCents = snapshot?.balanceCents ?? sale.balanceCents;
    const payload = {
      additions: sale.opticalAdditions, balanceCents, customer: sale.customer,
      discount: sale.discount, items: sale.items, paidCents, patient: sale.patient,
      payment: snapshot?.payment ?? sale.payments.at(-1) ?? null,
      paymentMethod: snapshot?.payment.paymentMethod ?? sale.paymentMethod,
      payments: snapshot?.payments ?? sale.payments, saleNumber: sale.saleNumber,
      status: balanceCents === 0 ? "PAID" : "PENDING", subtotalCents: sale.subtotalCents,
      totalCents: sale.totalCents,
    };
    const receipt = await client.sale_receipts.create({ data: {
      emailed_to: emailedTo, generated_by: actorUserId, payload,
      payment_id: request.paymentId, receipt_type: receiptType, sale_id: saleId,
    } });
    const template = receiptType === "PAYMENT" ? "POS_PAYMENT_RECEIPT" : "POS_FINAL_RECEIPT";
    await enqueueReceipt(client, receipt, emailedTo, saleId, request.paymentId, template);
    await insertSaleEvent(client, saleId, "RECEIPT_ISSUED", actorUserId, {
      details: { paymentId: request.paymentId, receiptNumber: Number(receipt.receipt_number), receiptType },
      newStatus: sale.status, previousStatus: sale.status,
    });
    if (request.paymentId && balanceCents === 0) {
      const existingFinal = await client.sale_receipts.findFirst({ where: { receipt_type: "FINAL", sale_id: saleId } });
      if (!existingFinal) {
        const finalReceipt = await client.sale_receipts.create({ data: {
          emailed_to: emailedTo, generated_by: actorUserId, payload,
          payment_id: null, receipt_type: "FINAL", sale_id: saleId,
        } });
        await enqueueReceipt(client, finalReceipt, emailedTo, saleId, null, "POS_FINAL_RECEIPT");
        await insertSaleEvent(client, saleId, "RECEIPT_ISSUED", actorUserId, {
          details: { paymentId: null, receiptNumber: Number(finalReceipt.receipt_number), receiptType: "FINAL" },
          newStatus: sale.status, previousStatus: sale.status,
        });
      }
    }
    return { reason: null, receipt: mapReceipt(receipt) };
  }, { isolationLevel: "Serializable" });
}

export async function findReceiptBySaleId(saleId, receiptId = null) {
  return mapReceipt(await prisma.sale_receipts.findFirst({
    orderBy: [{ issued_at: "desc" }, { receipt_number: "desc" }],
    where: { sale_id: saleId, ...(receiptId ? { id: receiptId } : {}) },
  }));
}
