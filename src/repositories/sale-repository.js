import { executeQuery, executeTransaction } from "../db/query.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

function mapSaleBase(row) {
  if (!row) return null;
  const paidCents = Number(row.paid_cents ?? 0);
  const totalCents = Number(row.total_cents);
  return {
    balanceCents: totalCents - paidCents,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    customer: {
      email: row.customer_email,
      firstNames: row.customer_first_names,
      id: row.customer_id,
      lastNames: row.customer_last_names,
      phone: row.customer_phone,
      rut: row.customer_rut,
    },
    id: row.id,
    discountCents: Number(row.discount_cents ?? 0),
    discountReason: row.discount_reason,
    discount: Number(row.discount_cents) > 0 ? {
      amountCents: Number(row.discount_cents),
      authorizedAt: row.discount_authorized_at,
      authorizedBy: row.discount_authorized_by ? {
        firstName: row.discount_authorizer_first_name,
        id: row.discount_authorized_by,
        lastName: row.discount_authorizer_last_name,
      } : null,
      reason: row.discount_reason,
    } : null,
    origin: row.origin,
    paidCents,
    paymentMethod: row.payment_method,
    fulfillment: row.fulfillment_method ? {
      address: row.delivery_address,
      city: row.delivery_city,
      method: row.fulfillment_method,
      notes: row.delivery_notes,
      region: row.delivery_region,
    } : null,
    externalPrescription: row.external_prescription_id ? {
      id: row.external_prescription_id,
      source: row.external_prescription_source,
      status: row.external_prescription_status,
    } : null,
    patient: row.sale_patient_id ? {
      firstNames: row.sale_patient_first_names,
      id: row.sale_patient_id,
      lastNames: row.sale_patient_last_names,
      rut: row.sale_patient_rut,
    } : null,
    prescription: row.prescription_id
      ? {
          id: row.prescription_id,
          patient: {
            firstNames: row.patient_first_names,
            id: row.patient_id,
            lastNames: row.patient_last_names,
            rut: row.patient_rut,
          },
          status: row.prescription_status,
          version: row.prescription_version,
        }
      : null,
    saleNumber: Number(row.sale_number),
    quotationValidUntil: row.quotation_valid_until,
    receipt: row.receipt_id ? {
      emailStatus: row.receipt_email_status,
      emailedTo: row.receipt_emailed_to,
      id: row.receipt_id,
      issuedAt: row.receipt_issued_at,
      paymentId: row.receipt_payment_id,
      receiptNumber: Number(row.receipt_number),
      type: row.receipt_type,
    } : null,
    status: row.status,
    shippingFeeCents: Number(row.shipping_fee_cents),
    shippingQuoteSource: row.shipping_quote_source,
    subtotalCents: Number(row.subtotal_cents),
    totalCents,
    updatedAt: row.updated_at,
  };
}

const SALE_SELECT = `
  SELECT
    sales.*,
    COALESCE(store_carts.buyer_rut, customers.rut) AS customer_rut,
    COALESCE(store_carts.buyer_email, customers.email) AS customer_email,
    COALESCE(store_carts.buyer_first_names, customers.first_names) AS customer_first_names,
    COALESCE(store_carts.buyer_last_names, customers.last_names) AS customer_last_names,
    COALESCE(store_carts.buyer_phone, customers.phone) AS customer_phone,
    optical_prescriptions.status AS prescription_status,
    optical_prescriptions.version AS prescription_version,
    clinical_encounters.patient_id,
    patients.rut AS patient_rut,
    patients.first_names AS patient_first_names,
    patients.last_names AS patient_last_names,
    sale_patients.id AS sale_patient_id,
    sale_patients.rut AS sale_patient_rut,
    sale_patients.first_names AS sale_patient_first_names,
    sale_patients.last_names AS sale_patient_last_names,
    discount_authorizer.first_name AS discount_authorizer_first_name,
    discount_authorizer.last_name AS discount_authorizer_last_name,
    external_prescriptions.source AS external_prescription_source,
    external_prescriptions.status AS external_prescription_status,
    sale_receipts.id AS receipt_id,
    sale_receipts.receipt_number,
    sale_receipts.emailed_to AS receipt_emailed_to,
    sale_receipts.email_status AS receipt_email_status,
    sale_receipts.issued_at AS receipt_issued_at,
    sale_receipts.payment_id AS receipt_payment_id,
    sale_receipts.receipt_type,
    COALESCE((
      SELECT SUM(sale_payments.amount_cents)
      FROM sale_payments
      WHERE sale_payments.sale_id = sales.id
    ), 0) AS paid_cents
  FROM sales
  JOIN customers ON customers.id = sales.customer_id
  LEFT JOIN store_carts ON store_carts.sale_id = sales.id
  LEFT JOIN optical_prescriptions ON optical_prescriptions.id = sales.prescription_id
  LEFT JOIN external_prescriptions
    ON external_prescriptions.id = sales.external_prescription_id
  LEFT JOIN clinical_encounters ON clinical_encounters.id = optical_prescriptions.encounter_id
  LEFT JOIN patients ON patients.id = clinical_encounters.patient_id
  LEFT JOIN patients AS sale_patients ON sale_patients.id = sales.patient_id
  LEFT JOIN users AS discount_authorizer
    ON discount_authorizer.id = sales.discount_authorized_by
  LEFT JOIN LATERAL (
    SELECT *
    FROM sale_receipts
    WHERE sale_receipts.sale_id = sales.id
    ORDER BY sale_receipts.issued_at DESC, sale_receipts.receipt_number DESC
    LIMIT 1
  ) AS sale_receipts ON TRUE
`;

async function findSaleWithClient(client, saleId) {
  const baseResult = await client.query(`${SALE_SELECT} WHERE sales.id = $1`, [
    saleId,
  ]);
  const sale = mapSaleBase(baseResult.rows[0]);
  if (!sale) return null;

  const [itemsResult, paymentsResult, additionsResult] = await Promise.all([
    client.query(
      `SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY position`,
      [saleId],
    ),
    client.query(
      `SELECT sale_payments.id, sale_payments.amount_cents,
              sale_payments.payment_method, sale_payments.reference,
              sale_payments.received_by, sale_payments.paid_at,
              sale_payments.source, sale_payments.provider_attempt_id,
              sale_receipts.id AS receipt_id,
              sale_receipts.receipt_number,
              sale_receipts.email_status AS receipt_email_status,
              sale_receipts.issued_at AS receipt_issued_at,
              sale_receipts.receipt_type
       FROM sale_payments
       LEFT JOIN sale_receipts ON sale_receipts.payment_id = sale_payments.id
       WHERE sale_payments.sale_id = $1
       ORDER BY sale_payments.paid_at, sale_payments.id`,
      [saleId],
    ),
    client.query(
      `SELECT id, name, description, position, quantity, unit_price_cents,
              line_total_cents
       FROM sale_optical_additions WHERE sale_id = $1 ORDER BY position`,
      [saleId],
    ),
  ]);

  return {
    ...sale,
    items: itemsResult.rows.map((row) => ({
      category: row.product_category,
      id: row.id,
      lineTotalCents: Number(row.line_total_cents),
      name: row.product_name,
      position: row.position,
      productId: row.product_id,
      quantity: row.quantity,
      requiresPrescription: row.requires_prescription,
      mount: row.mount_source ? {
        frameProductId: row.mounted_on_product_id,
        source: row.mount_source,
      } : null,
      sku: row.product_sku,
      unitPriceCents: Number(row.unit_price_cents),
    })),
    opticalAdditions: additionsResult.rows.map((row) => ({
      description: row.description,
      id: row.id,
      lineTotalCents: Number(row.line_total_cents),
      name: row.name,
      position: row.position,
      quantity: row.quantity,
      unitPriceCents: Number(row.unit_price_cents),
    })),
    payments: paymentsResult.rows.map((row) => ({
      amountCents: Number(row.amount_cents),
      id: row.id,
      paidAt: row.paid_at,
      paymentMethod: row.payment_method,
      providerAttemptId: row.provider_attempt_id,
      receivedBy: row.received_by,
      receipt: row.receipt_id ? {
        emailStatus: row.receipt_email_status,
        id: row.receipt_id,
        issuedAt: row.receipt_issued_at,
        receiptNumber: Number(row.receipt_number),
        type: row.receipt_type,
      } : null,
      reference: row.reference,
      source: row.source,
    })),
  };
}

export async function findSaleById(saleId) {
  return findSaleWithClient(
    { query: (text, parameters) => executeQuery(text, parameters) },
    saleId,
  );
}

async function loadDraftReferences(client, draft) {
  const customerResult = await client.query(
    "SELECT id FROM customers WHERE id = $1 FOR SHARE",
    [draft.customerId],
  );
  if (customerResult.rowCount === 0) return { reason: "CUSTOMER_NOT_FOUND" };

  if (draft.patientId) {
    const patientResult = await client.query(
      "SELECT id FROM patients WHERE id = $1 FOR SHARE",
      [draft.patientId],
    );
    if (patientResult.rowCount === 0) return { reason: "PATIENT_NOT_FOUND" };
  }

  const productResult = await client.query(
    `SELECT id, sku, name, category, requires_prescription, unit_price_cents, is_active
     FROM products WHERE id = ANY($1::UUID[]) FOR SHARE`,
    [draft.items.map((item) => item.productId)],
  );
  if (productResult.rowCount !== draft.items.length)
    return { reason: "PRODUCT_NOT_FOUND" };
  if (productResult.rows.some((product) => !product.is_active))
    return { reason: "PRODUCT_INACTIVE" };

  const productsById = new Map(
    productResult.rows.map((product) => [product.id, product]),
  );
  for (const item of draft.items) {
    const product = productsById.get(item.productId);
    if (product.category !== "PRESCRIPTION_LENS") {
      if (item.mount) return { reason: "UNEXPECTED_LENS_MOUNT" };
      continue;
    }
    if (!item.mount) return { reason: "LENS_MOUNT_REQUIRED" };
    if (item.mount.source === "CUSTOMER_FRAME") continue;
    const frame = productsById.get(item.mount.frameProductId);
    if (!frame || frame.category !== "FRAME") {
      return { reason: "INVALID_LENS_MOUNT" };
    }
  }

  let prescription = null;
  let externalPrescription = null;
  if (draft.prescriptionId) {
    const prescriptionResult = await client.query(
      `SELECT optical_prescriptions.id, optical_prescriptions.status,
              clinical_encounters.status AS encounter_status,
              clinical_encounters.patient_id
       FROM optical_prescriptions
       JOIN clinical_encounters ON clinical_encounters.id = optical_prescriptions.encounter_id
       WHERE optical_prescriptions.id = $1 FOR SHARE OF optical_prescriptions, clinical_encounters`,
      [draft.prescriptionId],
    );
    prescription = prescriptionResult.rows[0];
    if (!prescription) return { reason: "PRESCRIPTION_NOT_FOUND" };
    if (
      prescription.status !== "ACTIVE" ||
      prescription.encounter_status !== "FINALIZED"
    ) {
      return { reason: "PRESCRIPTION_NOT_USABLE" };
    }
    if (prescription.patient_id !== draft.patientId) {
      return { reason: "PRESCRIPTION_PATIENT_MISMATCH" };
    }
  }

  if (draft.externalPrescriptionId) {
    const result = await client.query(
      `SELECT id, status, customer_id, patient_id
       FROM external_prescriptions
       WHERE id = $1 FOR SHARE`,
      [draft.externalPrescriptionId],
    );
    externalPrescription = result.rows[0];
    if (!externalPrescription)
      return { reason: "EXTERNAL_PRESCRIPTION_NOT_FOUND" };
    if (
      externalPrescription.status !== "READY" ||
      externalPrescription.customer_id !== draft.customerId ||
      externalPrescription.patient_id !== draft.patientId
    ) {
      return { reason: "EXTERNAL_PRESCRIPTION_NOT_USABLE" };
    }
  }

  if (
    productResult.rows.some((product) => product.requires_prescription)
    && !prescription
    && !externalPrescription
  ) {
    return { reason: "PRESCRIPTION_REQUIRED" };
  }

  const lines = draft.items.map((item, index) => ({
    ...productsById.get(item.productId),
    mount: item.mount,
    position: index + 1,
    quantity: item.quantity,
  }));
  const productSubtotalCents = lines.reduce(
    (total, line) => total + Number(line.unit_price_cents) * line.quantity,
    0,
  );
  const additionsSubtotalCents = draft.opticalAdditions.reduce(
    (total, addition) => total + addition.unitPriceCents * addition.quantity,
    0,
  );
  const subtotalCents = productSubtotalCents + additionsSubtotalCents;
  const discountCents = draft.discount?.amountCents ?? 0;
  if (discountCents >= subtotalCents) return { reason: "DISCOUNT_EXCEEDS_SUBTOTAL" };
  return {
    additionsSubtotalCents,
    discountCents,
    lines,
    productSubtotalCents,
    reason: null,
    subtotalCents,
    totalCents: subtotalCents - discountCents,
  };
}

async function insertItems(client, saleId, lines) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO sale_items (
         sale_id, product_id, product_sku, product_name, product_category,
         requires_prescription, mount_source, mounted_on_product_id,
         position, quantity, unit_price_cents
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        saleId,
        line.id,
        line.sku,
        line.name,
        line.category,
        line.requires_prescription,
        line.mount?.source ?? null,
        line.mount?.frameProductId ?? null,
        line.position,
        line.quantity,
        line.unit_price_cents,
      ],
    );
  }
}

async function insertOpticalAdditions(client, saleId, additions) {
  for (const [index, addition] of additions.entries()) {
    await client.query(
      `INSERT INTO sale_optical_additions (
         sale_id, name, description, position, quantity, unit_price_cents
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [saleId, addition.name, addition.description, index + 1,
        addition.quantity, addition.unitPriceCents],
    );
  }
}

async function insertDiscountEvent(client, saleId, draft, actorUserId, status = "QUOTATION") {
  if (!draft.discount) return;
  await insertSaleEvent(client, saleId, "DISCOUNT_AUTHORIZED", actorUserId, {
    details: {
      amountCents: draft.discount.amountCents,
      authorizedBy: draft.discount.authorizedBy,
      reason: draft.discount.reason,
    },
    newStatus: status,
    previousStatus: status,
  });
}

async function insertSaleEvent(
  client,
  saleId,
  eventType,
  actorUserId,
  { details = null, newStatus = null, previousStatus = null } = {},
) {
  await client.query(
    `INSERT INTO sale_events (
       sale_id, event_type, previous_status, new_status, details, performed_by
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      saleId,
      eventType,
      previousStatus,
      newStatus,
      details == null ? null : JSON.stringify(details),
      actorUserId,
    ],
  );
}

export async function createSale(draft, actorUserId) {
  return executeTransaction(async (client) => {
    const references = await loadDraftReferences(client, draft);
    if (references.reason) return { reason: references.reason, sale: null };

    const saleResult = await client.query(
      `INSERT INTO sales (
         customer_id, patient_id, prescription_id, external_prescription_id,
         subtotal_cents, discount_cents, discount_reason,
         discount_authorized_by, discount_authorized_at, total_cents,
         quotation_valid_until, created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         CURRENT_TIMESTAMP + INTERVAL '30 days', $11, $11
       ) RETURNING id`,
      [draft.customerId, draft.patientId, draft.prescriptionId,
        draft.externalPrescriptionId, references.subtotalCents,
        references.discountCents, draft.discount?.reason ?? null,
        draft.discount?.authorizedBy ?? null, draft.discount?.authorizedAt ?? null,
        references.totalCents, actorUserId],
    );
    const saleId = saleResult.rows[0].id;
    await insertItems(client, saleId, references.lines);
    await insertOpticalAdditions(client, saleId, draft.opticalAdditions);
    await insertSaleEvent(client, saleId, "CREATED", actorUserId, {
      details: {
        additionsSubtotalCents: references.additionsSubtotalCents,
        discountCents: references.discountCents,
        discountReason: draft.discount?.reason ?? null,
        productSubtotalCents: references.productSubtotalCents,
        subtotalCents: references.subtotalCents,
        totalCents: references.totalCents,
      },
      newStatus: "QUOTATION",
    });
    await insertDiscountEvent(client, saleId, draft, actorUserId);
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function updateSaleDraft(saleId, draft, actorUserId) {
  return executeTransaction(async (client) => {
    const saleResult = await client.query(
      "SELECT status FROM sales WHERE id = $1 FOR UPDATE",
      [saleId],
    );
    if (saleResult.rowCount === 0)
      return { reason: "SALE_NOT_FOUND", sale: null };
    if (saleResult.rows[0].status !== "QUOTATION")
      return { reason: "SALE_NOT_EDITABLE", sale: null };
    const references = await loadDraftReferences(client, draft);
    if (references.reason) return { reason: references.reason, sale: null };

    await client.query("DELETE FROM sale_items WHERE sale_id = $1", [saleId]);
    await client.query("DELETE FROM sale_optical_additions WHERE sale_id = $1", [saleId]);
    await client.query(
      `UPDATE sales SET customer_id = $2, patient_id = $3, prescription_id = $4,
         external_prescription_id = $5, subtotal_cents = $6,
         discount_cents = $7, discount_reason = $8,
         discount_authorized_by = $9, discount_authorized_at = $10,
         total_cents = $11, updated_by = $12 WHERE id = $1`,
      [saleId, draft.customerId, draft.patientId, draft.prescriptionId,
        draft.externalPrescriptionId, references.subtotalCents,
        references.discountCents, draft.discount?.reason ?? null,
        draft.discount?.authorizedBy ?? null, draft.discount?.authorizedAt ?? null,
        references.totalCents, actorUserId],
    );
    await insertItems(client, saleId, references.lines);
    await insertOpticalAdditions(client, saleId, draft.opticalAdditions);
    await insertSaleEvent(client, saleId, "UPDATED", actorUserId, {
      details: {
        discountCents: references.discountCents,
        discountReason: draft.discount?.reason ?? null,
        subtotalCents: references.subtotalCents,
        totalCents: references.totalCents,
      },
      previousStatus: "QUOTATION",
      newStatus: "QUOTATION",
    });
    await insertDiscountEvent(client, saleId, draft, actorUserId);
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function confirmSale(saleId, actorUserId) {
  return executeTransaction(async (client) => {
    const saleResult = await client.query(
      `SELECT status, customer_id, patient_id, prescription_id, external_prescription_id,
              quotation_valid_until
       FROM sales WHERE id = $1 FOR UPDATE`,
      [saleId],
    );
    const sale = saleResult.rows[0];
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (sale.status !== "QUOTATION") return { reason: "SALE_NOT_CONFIRMABLE", sale: null };
    if (sale.quotation_valid_until && sale.quotation_valid_until < new Date()) {
      return { reason: "QUOTATION_EXPIRED", sale: null };
    }
    const productsResult = await client.query(
      `SELECT sale_items.requires_prescription, products.is_active
       FROM sale_items JOIN products ON products.id = sale_items.product_id
       WHERE sale_items.sale_id = $1 FOR SHARE OF products`,
      [saleId],
    );
    if (productsResult.rows.some((product) => !product.is_active)) {
      return { reason: "PRODUCT_INACTIVE", sale: null };
    }
    if (
      productsResult.rows.some((product) => product.requires_prescription)
      && !sale.prescription_id
      && !sale.external_prescription_id
    ) {
      return { reason: "PRESCRIPTION_REQUIRED", sale: null };
    }
    if (sale.prescription_id) {
      const prescriptionResult = await client.query(
        `SELECT optical_prescriptions.status, clinical_encounters.status AS encounter_status,
                clinical_encounters.patient_id
         FROM optical_prescriptions JOIN clinical_encounters
           ON clinical_encounters.id = optical_prescriptions.encounter_id
         WHERE optical_prescriptions.id = $1 FOR SHARE OF optical_prescriptions, clinical_encounters`,
        [sale.prescription_id],
      );
      const prescription = prescriptionResult.rows[0];
      if (
        !prescription ||
        prescription.status !== "ACTIVE" ||
        prescription.encounter_status !== "FINALIZED"
      ) {
        return { reason: "PRESCRIPTION_NOT_USABLE", sale: null };
      }
      if (prescription.patient_id !== sale.patient_id) {
        return { reason: "PRESCRIPTION_PATIENT_MISMATCH", sale: null };
      }
    }
    if (sale.external_prescription_id) {
      const result = await client.query(
        `SELECT status, customer_id, patient_id FROM external_prescriptions
         WHERE id = $1 FOR SHARE`,
        [sale.external_prescription_id],
      );
      const prescription = result.rows[0];
      if (
        !prescription ||
        prescription.status !== "READY" ||
        prescription.customer_id !== sale.customer_id ||
        prescription.patient_id !== sale.patient_id
      ) {
        return { reason: "EXTERNAL_PRESCRIPTION_NOT_USABLE", sale: null };
      }
    }

    await client.query(
      "UPDATE sales SET status = 'PENDING', updated_by = $2 WHERE id = $1",
      [saleId, actorUserId],
    );
    await insertSaleEvent(client, saleId, "STATUS_CHANGED", actorUserId, {
      previousStatus: "QUOTATION",
      newStatus: "PENDING",
    });
    const emailResult = await client.query(
      `SELECT sales.sale_number, sales.total_cents, customers.email
       FROM sales JOIN customers ON customers.id = sales.customer_id
       WHERE sales.id = $1`,
      [saleId],
    );
    await client.query(
      `INSERT INTO transactional_email_outbox (
         template_code, recipient_email, payload, deduplication_key, sale_id
       ) VALUES ('ORDER_CONFIRMED', $1, $2::JSONB, $3, $4)
       ON CONFLICT (deduplication_key) DO NOTHING`,
      [emailResult.rows[0].email, JSON.stringify({
        saleNumber: Number(emailResult.rows[0].sale_number),
        totalCents: Number(emailResult.rows[0].total_cents),
      }), transactionalEmailDeduplicationKey("ORDER_CONFIRMED", saleId), saleId],
    );
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function registerSalePayment(saleId, payment, actorUserId) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `SELECT sales.status, sales.payment_method, sales.total_cents,
              sales.sale_number, customers.email AS customer_email
       FROM sales JOIN customers ON customers.id = sales.customer_id
       WHERE sales.id = $1 FOR UPDATE OF sales`,
      [saleId],
    );
    const sale = result.rows[0];
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (sale.status !== "PENDING")
      return { reason: "SALE_NOT_PAYABLE", sale: null };
    if (sale.payment_method && sale.payment_method !== payment.paymentMethod) {
      return { reason: "PAYMENT_METHOD_MISMATCH", sale: null };
    }
    const activeAttemptResult = await client.query(
      `SELECT id FROM payment_attempts
       WHERE sale_id = $1 AND status IN ('CREATED', 'PENDING')
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [saleId],
    );
    if (activeAttemptResult.rowCount > 0) {
      return { reason: "PAYMENT_ATTEMPT_ACTIVE", sale: null };
    }
    const paidResult = await client.query(
      "SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM sale_payments WHERE sale_id = $1",
      [saleId],
    );
    const paidCents = Number(paidResult.rows[0].paid_cents);
    const totalCents = Number(sale.total_cents);
    if (payment.amountCents > totalCents - paidCents) {
      return { reason: "PAYMENT_EXCEEDS_BALANCE", sale: null };
    }

    const paymentResult = await client.query(
      `INSERT INTO sale_payments (
         sale_id, amount_cents, payment_method, reference, received_by
       ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        saleId,
        payment.amountCents,
        payment.paymentMethod,
        payment.reference,
        actorUserId,
      ],
    );
    const newStatus =
      paidCents + payment.amountCents === totalCents ? "PAID" : "PENDING";
    await client.query(
      `UPDATE sales SET payment_method = $2, status = $3, updated_by = $4 WHERE id = $1`,
      [saleId, payment.paymentMethod, newStatus, actorUserId],
    );
    await insertSaleEvent(client, saleId, "PAYMENT_REGISTERED", actorUserId, {
      details: {
        amountCents: payment.amountCents,
        paymentMethod: payment.paymentMethod,
      },
      previousStatus: "PENDING",
      newStatus,
    });
    const paymentId = paymentResult.rows[0].id;
    await client.query(
      `INSERT INTO transactional_email_outbox (
         template_code, recipient_email, payload, deduplication_key,
         sale_id, payment_id
       ) VALUES ('PAYMENT_CONFIRMED', $1, $2::JSONB, $3, $4, $5)
       ON CONFLICT (deduplication_key) DO NOTHING`,
      [sale.customer_email, JSON.stringify({
        amountCents: payment.amountCents,
        saleNumber: Number(sale.sale_number),
      }), transactionalEmailDeduplicationKey("PAYMENT_CONFIRMED", paymentId),
      saleId, paymentId],
    );
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

const ALLOWED_TRANSITIONS = Object.freeze({
  PAID: ["IN_PREPARATION"],
  IN_PREPARATION: ["READY"],
  READY: ["DELIVERED"],
});

export async function changeSaleStatus(saleId, change, actorUserId, changedAt) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      "SELECT status FROM sales WHERE id = $1 FOR UPDATE",
      [saleId],
    );
    const current = result.rows[0];
    if (!current) return { reason: "SALE_NOT_FOUND", sale: null };

    if (change.status === "CANCELLED") {
      if (!["QUOTATION", "PENDING"].includes(current.status)) {
        return { reason: "SALE_NOT_CANCELLABLE", sale: null };
      }
      const payments = await client.query(
        "SELECT COUNT(*) AS count FROM sale_payments WHERE sale_id = $1",
        [saleId],
      );
      if (Number(payments.rows[0].count) > 0) {
        return { reason: "SALE_HAS_PAYMENTS", sale: null };
      }
      await client.query(
        `UPDATE sales SET status = 'CANCELLED', cancellation_reason = $2,
           cancelled_at = $3, updated_by = $4 WHERE id = $1`,
        [saleId, change.cancellationReason, changedAt, actorUserId],
      );
      await insertSaleEvent(client, saleId, "CANCELLED", actorUserId, {
        details: { reason: change.cancellationReason },
        previousStatus: current.status,
        newStatus: "CANCELLED",
      });
    } else {
      if (
        !(ALLOWED_TRANSITIONS[current.status] ?? []).includes(change.status)
      ) {
        return { reason: "INVALID_STATUS_TRANSITION", sale: null };
      }
      await client.query(
        "UPDATE sales SET status = $2, updated_by = $3 WHERE id = $1",
        [saleId, change.status, actorUserId],
      );
      await insertSaleEvent(client, saleId, "STATUS_CHANGED", actorUserId, {
        previousStatus: current.status,
        newStatus: change.status,
      });
    }
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function listSales({ customerId, page, pageSize, status }) {
  const offset = (page - 1) * pageSize;
  const filters = `
    ($1::UUID IS NULL OR sales.customer_id = $1)
    AND ($2::VARCHAR IS NULL OR sales.status = $2)
  `;
  const parameters = [customerId, status];
  const [itemsResult, countResult] = await Promise.all([
    executeQuery(
      `${SALE_SELECT} WHERE ${filters}
       ORDER BY sales.created_at DESC, sales.sale_number DESC LIMIT $3 OFFSET $4`,
      [...parameters, pageSize, offset],
    ),
    executeQuery(
      `SELECT COUNT(*) AS total FROM sales WHERE ${filters}`,
      parameters,
    ),
  ]);
  const total = Number(countResult.rows[0].total);
  return {
    items: itemsResult.rows.map(mapSaleBase),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export async function listSaleEvents(saleId) {
  const result = await executeQuery(
    `SELECT id, event_type, previous_status, new_status, details, performed_by, created_at
     FROM sale_events WHERE sale_id = $1 ORDER BY created_at, id`,
    [saleId],
  );
  return result.rows.map((row) => ({
    createdAt: row.created_at,
    details: typeof row.details === "string" ? JSON.parse(row.details) : row.details,
    eventType: row.event_type,
    id: Number(row.id),
    newStatus: row.new_status,
    performedBy: row.performed_by,
    previousStatus: row.previous_status,
  }));
}

function mapReceipt(row) {
  if (!row) return null;
  return {
    emailError: row.email_error,
    emailProviderId: row.email_provider_id,
    emailStatus: row.email_status,
    emailedTo: row.emailed_to,
    id: row.id,
    issuedAt: row.issued_at,
    paymentId: row.payment_id,
    payload: row.payload,
    receiptNumber: Number(row.receipt_number),
    saleId: row.sale_id,
    type: row.receipt_type,
  };
}

export function buildPaymentReceiptSnapshot(sale, paymentId) {
  if (!paymentId) return null;
  const paymentIndex = sale.payments.findIndex((payment) => payment.id === paymentId);
  if (paymentIndex === -1) return null;
  const payments = sale.payments.slice(0, paymentIndex + 1);
  const paidCents = payments.reduce((total, payment) => total + payment.amountCents, 0);
  return {
    balanceCents: sale.totalCents - paidCents,
    paidCents,
    payment: payments.at(-1),
    payments,
    type: "PAYMENT",
  };
}

export async function issueSaleReceipt(saleId, request, actorUserId) {
  return executeTransaction(async (client) => {
    const lockedResult = await client.query(
      "SELECT status FROM sales WHERE id = $1 FOR UPDATE",
      [saleId],
    );
    const locked = lockedResult.rows[0];
    if (!locked) return { reason: "SALE_NOT_FOUND", receipt: null };
    if (["QUOTATION", "CANCELLED"].includes(locked.status)) {
      return { reason: "RECEIPT_NOT_AVAILABLE", receipt: null };
    }

    const sale = await findSaleWithClient(client, saleId);
    const snapshot = buildPaymentReceiptSnapshot(sale, request.paymentId);
    if (request.paymentId && !snapshot) {
      return { reason: "PAYMENT_NOT_FOUND", receipt: null };
    }
    if (!snapshot && sale.status === "PENDING") {
      return { reason: "RECEIPT_PAYMENT_REQUIRED", receipt: null };
    }
    const receiptType = snapshot?.type ?? "FINAL";
    const existingResult = await client.query(
      `SELECT * FROM sale_receipts
       WHERE sale_id = $1
         AND (
           ($2::UUID IS NOT NULL AND payment_id = $2)
           OR ($3 = 'FINAL' AND receipt_type = 'FINAL')
         )
       ORDER BY issued_at DESC, receipt_number DESC
       LIMIT 1`,
      [saleId, request.paymentId, receiptType],
    );
    if (existingResult.rows[0]) {
      return { reason: null, receipt: mapReceipt(existingResult.rows[0]) };
    }

    const emailedTo = request.email ?? sale.customer.email;
    const paidCents = snapshot?.paidCents ?? sale.paidCents;
    const balanceCents = snapshot?.balanceCents ?? sale.balanceCents;
    const payload = {
      additions: sale.opticalAdditions,
      balanceCents,
      customer: sale.customer,
      discount: sale.discount,
      items: sale.items,
      paidCents,
      patient: sale.patient,
      payment: snapshot?.payment ?? sale.payments.at(-1) ?? null,
      paymentMethod: snapshot?.payment.paymentMethod ?? sale.paymentMethod,
      payments: snapshot?.payments ?? sale.payments,
      saleNumber: sale.saleNumber,
      status: balanceCents === 0 ? "PAID" : "PENDING",
      subtotalCents: sale.subtotalCents,
      totalCents: sale.totalCents,
    };
    const result = await client.query(
      `INSERT INTO sale_receipts (
         sale_id, payment_id, receipt_type, payload, emailed_to, generated_by
       ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [saleId, request.paymentId, receiptType, payload, emailedTo, actorUserId],
    );
    await client.query(
      `INSERT INTO transactional_email_outbox (
         template_code, recipient_email, payload, deduplication_key,
         sale_id, payment_id, receipt_id
       ) VALUES ($1, $2, '{}'::JSONB, $3, $4, $5, $6)
       ON CONFLICT (deduplication_key) DO NOTHING`,
      [receiptType === "PAYMENT" ? "POS_PAYMENT_RECEIPT" : "POS_FINAL_RECEIPT",
        emailedTo, transactionalEmailDeduplicationKey(
          receiptType === "PAYMENT" ? "POS_PAYMENT_RECEIPT" : "POS_FINAL_RECEIPT",
          result.rows[0].id,
        ), saleId, request.paymentId, result.rows[0].id],
    );
    await insertSaleEvent(client, saleId, "RECEIPT_ISSUED", actorUserId, {
      details: {
        paymentId: request.paymentId,
        receiptNumber: Number(result.rows[0].receipt_number),
        receiptType,
      },
      newStatus: sale.status,
      previousStatus: sale.status,
    });
    if (request.paymentId && balanceCents === 0) {
      const finalResult = await client.query(
        `INSERT INTO sale_receipts (
           sale_id, payment_id, receipt_type, payload, emailed_to, generated_by
         ) VALUES ($1, NULL, 'FINAL', $2, $3, $4)
         ON CONFLICT (sale_id) WHERE receipt_type = 'FINAL' DO NOTHING
         RETURNING *`,
        [saleId, payload, emailedTo, actorUserId],
      );
      if (finalResult.rows[0]) {
        await client.query(
          `INSERT INTO transactional_email_outbox (
             template_code, recipient_email, payload, deduplication_key,
             sale_id, receipt_id
           ) VALUES ('POS_FINAL_RECEIPT', $1, '{}'::JSONB, $2, $3, $4)
           ON CONFLICT (deduplication_key) DO NOTHING`,
          [emailedTo, transactionalEmailDeduplicationKey(
            "POS_FINAL_RECEIPT",
            finalResult.rows[0].id,
          ), saleId, finalResult.rows[0].id],
        );
        await insertSaleEvent(client, saleId, "RECEIPT_ISSUED", actorUserId, {
          details: {
            paymentId: null,
            receiptNumber: Number(finalResult.rows[0].receipt_number),
            receiptType: "FINAL",
          },
          newStatus: sale.status,
          previousStatus: sale.status,
        });
      }
    }
    return { reason: null, receipt: mapReceipt(result.rows[0]) };
  });
}

export async function findReceiptBySaleId(saleId, receiptId = null) {
  const result = await executeQuery(
    `SELECT * FROM sale_receipts
     WHERE sale_id = $1 AND ($2::UUID IS NULL OR id = $2)
     ORDER BY issued_at DESC, receipt_number DESC
     LIMIT 1`,
    [saleId, receiptId],
  );
  return mapReceipt(result.rows[0]);
}

export async function getSalesReport({ from, timeZone, to }) {
  const dateFilter = `
    sales.origin = 'IN_STORE'
    AND (sales.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
  `;
  const [summaryResult, statusResult, paymentResult, dailyResult] = await Promise.all([
    executeQuery(
      `SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('QUOTATION', 'CANCELLED')) AS sale_count,
         COUNT(*) FILTER (WHERE status = 'QUOTATION') AS quotation_count,
         COALESCE(SUM(subtotal_cents) FILTER (
           WHERE status NOT IN ('QUOTATION', 'CANCELLED')
         ), 0) AS subtotal_cents,
         COALESCE(SUM(discount_cents) FILTER (
           WHERE status NOT IN ('QUOTATION', 'CANCELLED')
         ), 0) AS discount_cents,
         COALESCE(SUM(total_cents) FILTER (
           WHERE status NOT IN ('QUOTATION', 'CANCELLED')
         ), 0) AS total_cents,
         COALESCE(SUM(CASE
           WHEN status NOT IN ('QUOTATION', 'CANCELLED') THEN
             GREATEST(total_cents - COALESCE((
               SELECT SUM(amount_cents) FROM sale_payments
               WHERE sale_payments.sale_id = sales.id
             ), 0), 0)
           ELSE 0 END), 0) AS balance_cents
       FROM sales WHERE ${dateFilter}`,
      [from, to, timeZone],
    ),
    executeQuery(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
       FROM sales WHERE ${dateFilter}
       GROUP BY status ORDER BY status`,
      [from, to, timeZone],
    ),
    executeQuery(
      `SELECT sale_payments.payment_method,
              COUNT(*) AS payment_count,
              COALESCE(SUM(sale_payments.amount_cents), 0) AS paid_cents
       FROM sale_payments
       JOIN sales ON sales.id = sale_payments.sale_id
       WHERE ${dateFilter}
       GROUP BY sale_payments.payment_method
       ORDER BY sale_payments.payment_method`,
      [from, to, timeZone],
    ),
    executeQuery(
      `SELECT (sales.created_at AT TIME ZONE $3)::date AS date,
              COUNT(*) AS sale_count,
              COALESCE(SUM(total_cents), 0) AS total_cents
       FROM sales
       WHERE ${dateFilter} AND status NOT IN ('QUOTATION', 'CANCELLED')
       GROUP BY date ORDER BY date`,
      [from, to, timeZone],
    ),
  ]);
  const summary = summaryResult.rows[0];
  return {
    daily: dailyResult.rows.map((row) => ({
      date: row.date,
      saleCount: Number(row.sale_count),
      totalCents: Number(row.total_cents),
    })),
    from,
    payments: paymentResult.rows.map((row) => ({
      paidCents: Number(row.paid_cents),
      paymentCount: Number(row.payment_count),
      paymentMethod: row.payment_method,
    })),
    statuses: statusResult.rows.map((row) => ({
      count: Number(row.count),
      status: row.status,
      totalCents: Number(row.total_cents),
    })),
    summary: {
      balanceCents: Number(summary.balance_cents),
      discountCents: Number(summary.discount_cents),
      quotationCount: Number(summary.quotation_count),
      saleCount: Number(summary.sale_count),
      subtotalCents: Number(summary.subtotal_cents),
      totalCents: Number(summary.total_cents),
    },
    to,
  };
}
