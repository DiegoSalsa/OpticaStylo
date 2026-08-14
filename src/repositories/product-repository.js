import { executeQuery, executeTransaction } from "../db/query.js";

function mapProduct(row) {
  if (!row) return null;
  return {
    category: row.category,
    createdAt: row.created_at,
    id: row.id,
    isActive: row.is_active,
    name: row.name,
    requiresPrescription: row.requires_prescription,
    sku: row.sku,
    unitPriceCents: Number(row.unit_price_cents),
    updatedAt: row.updated_at,
  };
}

async function insertEvent(client, productId, eventType, changedFields, actorUserId) {
  await client.query(
    `INSERT INTO product_events (product_id, event_type, changed_fields, performed_by)
     VALUES ($1, $2, $3, $4)`,
    [productId, eventType, changedFields, actorUserId],
  );
}

export async function createProduct(product, actorUserId) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO products (
          sku, name, category, requires_prescription, unit_price_cents,
          is_active, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6)
        RETURNING *
      `,
      [product.sku, product.name, product.category, product.requiresPrescription,
        product.unitPriceCents, actorUserId],
    );
    const created = mapProduct(result.rows[0]);
    await insertEvent(client, created.id, "CREATED", [], actorUserId);
    return created;
  });
}

export async function findProductById(productId) {
  const result = await executeQuery("SELECT * FROM products WHERE id = $1", [productId]);
  return mapProduct(result.rows[0]);
}

export async function listProducts({ category, isActive, page, pageSize, search }) {
  const offset = (page - 1) * pageSize;
  const pattern = `%${search}%`;
  const parameters = [search, pattern, category, isActive];
  const filters = `
    ($1 = '' OR sku ILIKE $2 OR name ILIKE $2)
    AND ($3::VARCHAR IS NULL OR category = $3)
    AND ($4::BOOLEAN IS NULL OR is_active = $4)
  `;
  const [itemsResult, countResult] = await Promise.all([
    executeQuery(
      `SELECT * FROM products WHERE ${filters}
       ORDER BY is_active DESC, category, name, id LIMIT $5 OFFSET $6`,
      [...parameters, pageSize, offset],
    ),
    executeQuery(`SELECT COUNT(*) AS total FROM products WHERE ${filters}`, parameters),
  ]);
  const total = Number(countResult.rows[0].total);
  return {
    items: itemsResult.rows.map(mapProduct),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export async function updateProduct(productId, product, changedFields, actorUserId) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE products
        SET sku = $2, name = $3, category = $4, requires_prescription = $5,
            unit_price_cents = $6, is_active = $7, updated_by = $8
        WHERE id = $1
        RETURNING *
      `,
      [productId, product.sku, product.name, product.category,
        product.requiresPrescription, product.unitPriceCents, product.isActive,
        actorUserId],
    );
    const updated = mapProduct(result.rows[0]);
    if (updated) await insertEvent(client, productId, "UPDATED", changedFields, actorUserId);
    return updated;
  });
}

export async function listProductEvents(productId) {
  const result = await executeQuery(
    `SELECT id, event_type, changed_fields, performed_by, created_at
     FROM product_events WHERE product_id = $1 ORDER BY created_at, id`,
    [productId],
  );
  return result.rows.map((row) => ({
    changedFields: row.changed_fields,
    createdAt: row.created_at,
    eventType: row.event_type,
    id: Number(row.id),
    performedBy: row.performed_by,
  }));
}
