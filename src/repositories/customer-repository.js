import { executeQuery } from "../db/query.js";

function mapCustomer(row) {
  if (!row) return null;
  return {
    address: row.address,
    createdAt: row.created_at,
    email: row.email,
    firstNames: row.first_names,
    id: row.id,
    lastNames: row.last_names,
    patientId: row.patient_id,
    phone: row.phone,
    rut: row.rut,
    updatedAt: row.updated_at,
  };
}

export async function createCustomer(customer, actorUserId) {
  const result = await executeQuery(
    `
      INSERT INTO customers (
        patient_id, rut, first_names, last_names, phone, email, address,
        created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      RETURNING *
    `,
    [
      customer.patientId,
      customer.rut,
      customer.firstNames,
      customer.lastNames,
      customer.phone,
      customer.email,
      customer.address,
      actorUserId,
    ],
  );
  return mapCustomer(result.rows[0]);
}

export async function findCustomerById(customerId) {
  const result = await executeQuery("SELECT * FROM customers WHERE id = $1", [customerId]);
  return mapCustomer(result.rows[0]);
}

export async function listCustomers({ page, pageSize, search }) {
  const offset = (page - 1) * pageSize;
  const pattern = `%${search}%`;
  const compactPattern = `%${search.replace(/[.\s-]/g, "")}%`;
  const filters = `
    $1 = ''
    OR first_names ILIKE $2
    OR last_names ILIKE $2
    OR concat_ws(' ', first_names, last_names) ILIKE $2
    OR email ILIKE $2
    OR phone ILIKE $2
    OR replace(rut, '-', '') ILIKE $3
  `;
  const parameters = [search, pattern, compactPattern];
  const [itemsResult, countResult] = await Promise.all([
    executeQuery(
      `SELECT * FROM customers WHERE ${filters}
       ORDER BY last_names, first_names, id LIMIT $4 OFFSET $5`,
      [...parameters, pageSize, offset],
    ),
    executeQuery(`SELECT COUNT(*) AS total FROM customers WHERE ${filters}`, parameters),
  ]);
  const total = Number(countResult.rows[0].total);
  return {
    items: itemsResult.rows.map(mapCustomer),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export async function updateCustomer(customerId, customer, actorUserId) {
  const result = await executeQuery(
    `
      UPDATE customers
      SET rut = $2, first_names = $3, last_names = $4, phone = $5,
          email = $6, address = $7, updated_by = $8
      WHERE id = $1
      RETURNING *
    `,
    [
      customerId,
      customer.rut,
      customer.firstNames,
      customer.lastNames,
      customer.phone,
      customer.email,
      customer.address,
      actorUserId,
    ],
  );
  return mapCustomer(result.rows[0]);
}
