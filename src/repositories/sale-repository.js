import { executeQuery, executeTransaction } from "../db/query.js";

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
      firstNames: row.customer_first_names,
      id: row.customer_id,
      lastNames: row.customer_last_names,
      rut: row.customer_rut,
    },
    id: row.id,
    paidCents,
    paymentMethod: row.payment_method,
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
    status: row.status,
    subtotalCents: Number(row.subtotal_cents),
    totalCents,
    updatedAt: row.updated_at,
  };
}

const SALE_SELECT = `
  SELECT
    sales.*,
    customers.rut AS customer_rut,
    customers.first_names AS customer_first_names,
    customers.last_names AS customer_last_names,
    optical_prescriptions.status AS prescription_status,
    optical_prescriptions.version AS prescription_version,
    clinical_encounters.patient_id,
    patients.rut AS patient_rut,
    patients.first_names AS patient_first_names,
    patients.last_names AS patient_last_names,
    COALESCE((
      SELECT SUM(sale_payments.amount_cents)
      FROM sale_payments
      WHERE sale_payments.sale_id = sales.id
    ), 0) AS paid_cents
  FROM sales
  JOIN customers ON customers.id = sales.customer_id
  LEFT JOIN optical_prescriptions ON optical_prescriptions.id = sales.prescription_id
  LEFT JOIN clinical_encounters ON clinical_encounters.id = optical_prescriptions.encounter_id
  LEFT JOIN patients ON patients.id = clinical_encounters.patient_id
`;

async function findSaleWithClient(client, saleId) {
  const baseResult = await client.query(`${SALE_SELECT} WHERE sales.id = $1`, [saleId]);
  const sale = mapSaleBase(baseResult.rows[0]);
  if (!sale) return null;

  const [itemsResult, paymentsResult] = await Promise.all([
    client.query(
      `SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY position`,
      [saleId],
    ),
    client.query(
      `SELECT id, amount_cents, payment_method, reference, received_by, paid_at
       FROM sale_payments WHERE sale_id = $1 ORDER BY paid_at, id`,
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
      sku: row.product_sku,
      unitPriceCents: Number(row.unit_price_cents),
    })),
    payments: paymentsResult.rows.map((row) => ({
      amountCents: Number(row.amount_cents),
      id: row.id,
      paidAt: row.paid_at,
      paymentMethod: row.payment_method,
      receivedBy: row.received_by,
      reference: row.reference,
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
  const customerResult = await client.query("SELECT id FROM customers WHERE id = $1 FOR SHARE", [draft.customerId]);
  if (customerResult.rowCount === 0) return { reason: "CUSTOMER_NOT_FOUND" };

  const productResult = await client.query(
    `SELECT id, sku, name, category, requires_prescription, unit_price_cents, is_active
     FROM products WHERE id = ANY($1::UUID[]) FOR SHARE`,
    [draft.items.map((item) => item.productId)],
  );
  if (productResult.rowCount !== draft.items.length) return { reason: "PRODUCT_NOT_FOUND" };
  if (productResult.rows.some((product) => !product.is_active)) return { reason: "PRODUCT_INACTIVE" };

  let prescription = null;
  if (draft.prescriptionId) {
    const prescriptionResult = await client.query(
      `SELECT optical_prescriptions.id, optical_prescriptions.status,
              clinical_encounters.status AS encounter_status
       FROM optical_prescriptions
       JOIN clinical_encounters ON clinical_encounters.id = optical_prescriptions.encounter_id
       WHERE optical_prescriptions.id = $1 FOR SHARE OF optical_prescriptions, clinical_encounters`,
      [draft.prescriptionId],
    );
    prescription = prescriptionResult.rows[0];
    if (!prescription) return { reason: "PRESCRIPTION_NOT_FOUND" };
    if (prescription.status !== "ACTIVE" || prescription.encounter_status !== "FINALIZED") {
      return { reason: "PRESCRIPTION_NOT_USABLE" };
    }
  }

  if (productResult.rows.some((product) => product.requires_prescription) && !prescription) {
    return { reason: "PRESCRIPTION_REQUIRED" };
  }

  const productsById = new Map(productResult.rows.map((product) => [product.id, product]));
  const lines = draft.items.map((item, index) => ({
    ...productsById.get(item.productId),
    position: index + 1,
    quantity: item.quantity,
  }));
  const totalCents = lines.reduce(
    (total, line) => total + Number(line.unit_price_cents) * line.quantity,
    0,
  );
  return { lines, reason: null, totalCents };
}

async function insertItems(client, saleId, lines) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO sale_items (
         sale_id, product_id, product_sku, product_name, product_category,
         requires_prescription, position, quantity, unit_price_cents
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [saleId, line.id, line.sku, line.name, line.category,
        line.requires_prescription, line.position, line.quantity,
        line.unit_price_cents],
    );
  }
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
    [saleId, eventType, previousStatus, newStatus,
      details == null ? null : JSON.stringify(details), actorUserId],
  );
}

export async function createSale(draft, actorUserId) {
  return executeTransaction(async (client) => {
    const references = await loadDraftReferences(client, draft);
    if (references.reason) return { reason: references.reason, sale: null };

    const saleResult = await client.query(
      `INSERT INTO sales (
         customer_id, prescription_id, subtotal_cents, total_cents,
         created_by, updated_by
       ) VALUES ($1, $2, $3, $3, $4, $4) RETURNING id`,
      [draft.customerId, draft.prescriptionId, references.totalCents, actorUserId],
    );
    const saleId = saleResult.rows[0].id;
    await insertItems(client, saleId, references.lines);
    await insertSaleEvent(client, saleId, "CREATED", actorUserId, {
      details: { totalCents: references.totalCents }, newStatus: "QUOTATION",
    });
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function updateSaleDraft(saleId, draft, actorUserId) {
  return executeTransaction(async (client) => {
    const saleResult = await client.query("SELECT status FROM sales WHERE id = $1 FOR UPDATE", [saleId]);
    if (saleResult.rowCount === 0) return { reason: "SALE_NOT_FOUND", sale: null };
    if (saleResult.rows[0].status !== "QUOTATION") return { reason: "SALE_NOT_EDITABLE", sale: null };
    const references = await loadDraftReferences(client, draft);
    if (references.reason) return { reason: references.reason, sale: null };

    await client.query("DELETE FROM sale_items WHERE sale_id = $1", [saleId]);
    await client.query(
      `UPDATE sales SET customer_id = $2, prescription_id = $3,
         subtotal_cents = $4, total_cents = $4, updated_by = $5 WHERE id = $1`,
      [saleId, draft.customerId, draft.prescriptionId, references.totalCents, actorUserId],
    );
    await insertItems(client, saleId, references.lines);
    await insertSaleEvent(client, saleId, "UPDATED", actorUserId, {
      details: { totalCents: references.totalCents },
      previousStatus: "QUOTATION", newStatus: "QUOTATION",
    });
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function confirmSale(saleId, actorUserId) {
  return executeTransaction(async (client) => {
    const saleResult = await client.query(
      "SELECT status, prescription_id FROM sales WHERE id = $1 FOR UPDATE",
      [saleId],
    );
    const sale = saleResult.rows[0];
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (sale.status !== "QUOTATION") return { reason: "SALE_NOT_CONFIRMABLE", sale: null };
    const productsResult = await client.query(
      `SELECT sale_items.requires_prescription, products.is_active
       FROM sale_items JOIN products ON products.id = sale_items.product_id
       WHERE sale_items.sale_id = $1 FOR SHARE OF products`,
      [saleId],
    );
    if (productsResult.rows.some((product) => !product.is_active)) {
      return { reason: "PRODUCT_INACTIVE", sale: null };
    }
    if (productsResult.rows.some((product) => product.requires_prescription) && !sale.prescription_id) {
      return { reason: "PRESCRIPTION_REQUIRED", sale: null };
    }
    if (sale.prescription_id) {
      const prescriptionResult = await client.query(
        `SELECT optical_prescriptions.status, clinical_encounters.status AS encounter_status
         FROM optical_prescriptions JOIN clinical_encounters
           ON clinical_encounters.id = optical_prescriptions.encounter_id
         WHERE optical_prescriptions.id = $1 FOR SHARE OF optical_prescriptions, clinical_encounters`,
        [sale.prescription_id],
      );
      const prescription = prescriptionResult.rows[0];
      if (!prescription || prescription.status !== "ACTIVE" || prescription.encounter_status !== "FINALIZED") {
        return { reason: "PRESCRIPTION_NOT_USABLE", sale: null };
      }
    }

    await client.query(
      "UPDATE sales SET status = 'PENDING', updated_by = $2 WHERE id = $1",
      [saleId, actorUserId],
    );
    await insertSaleEvent(client, saleId, "STATUS_CHANGED", actorUserId, {
      previousStatus: "QUOTATION", newStatus: "PENDING",
    });
    return { reason: null, sale: await findSaleWithClient(client, saleId) };
  });
}

export async function registerSalePayment(saleId, payment, actorUserId) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `SELECT status, payment_method, total_cents FROM sales WHERE id = $1 FOR UPDATE`,
      [saleId],
    );
    const sale = result.rows[0];
    if (!sale) return { reason: "SALE_NOT_FOUND", sale: null };
    if (sale.status !== "PENDING") return { reason: "SALE_NOT_PAYABLE", sale: null };
    if (sale.payment_method && sale.payment_method !== payment.paymentMethod) {
      return { reason: "PAYMENT_METHOD_MISMATCH", sale: null };
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

    await client.query(
      `INSERT INTO sale_payments (
         sale_id, amount_cents, payment_method, reference, received_by
       ) VALUES ($1, $2, $3, $4, $5)`,
      [saleId, payment.amountCents, payment.paymentMethod, payment.reference, actorUserId],
    );
    const newStatus = paidCents + payment.amountCents === totalCents ? "PAID" : "PENDING";
    await client.query(
      `UPDATE sales SET payment_method = $2, status = $3, updated_by = $4 WHERE id = $1`,
      [saleId, payment.paymentMethod, newStatus, actorUserId],
    );
    await insertSaleEvent(client, saleId, "PAYMENT_REGISTERED", actorUserId, {
      details: { amountCents: payment.amountCents, paymentMethod: payment.paymentMethod },
      previousStatus: "PENDING", newStatus,
    });
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
    const result = await client.query("SELECT status FROM sales WHERE id = $1 FOR UPDATE", [saleId]);
    const current = result.rows[0];
    if (!current) return { reason: "SALE_NOT_FOUND", sale: null };

    if (change.status === "CANCELLED") {
      if (!["QUOTATION", "PENDING"].includes(current.status)) {
        return { reason: "SALE_NOT_CANCELLABLE", sale: null };
      }
      const payments = await client.query(
        "SELECT COUNT(*) AS count FROM sale_payments WHERE sale_id = $1", [saleId],
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
        previousStatus: current.status, newStatus: "CANCELLED",
      });
    } else {
      if (!(ALLOWED_TRANSITIONS[current.status] ?? []).includes(change.status)) {
        return { reason: "INVALID_STATUS_TRANSITION", sale: null };
      }
      await client.query(
        "UPDATE sales SET status = $2, updated_by = $3 WHERE id = $1",
        [saleId, change.status, actorUserId],
      );
      await insertSaleEvent(client, saleId, "STATUS_CHANGED", actorUserId, {
        previousStatus: current.status, newStatus: change.status,
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
    executeQuery(`SELECT COUNT(*) AS total FROM sales WHERE ${filters}`, parameters),
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
    details: row.details ? JSON.parse(row.details) : null,
    eventType: row.event_type,
    id: Number(row.id),
    newStatus: row.new_status,
    performedBy: row.performed_by,
    previousStatus: row.previous_status,
  }));
}
