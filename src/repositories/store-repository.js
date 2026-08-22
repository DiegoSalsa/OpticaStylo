import { executeQuery, executeTransaction } from "../db/query.js";

function mapCartBase(row) {
  if (!row) return null;
  return {
    buyer: row.buyer_rut ? {
      address: row.buyer_address,
      email: row.buyer_email,
      firstNames: row.buyer_first_names,
      lastNames: row.buyer_last_names,
      phone: row.buyer_phone,
      rut: row.buyer_rut,
    } : null,
    checkedOutAt: row.checked_out_at,
    clinicalPrescriptionId: row.clinical_prescription_id,
    createdAt: row.created_at,
    customerAccountId: row.customer_account_id,
    expiresAt: row.expires_at,
    fulfillment: row.fulfillment_method ? {
      address: row.delivery_address,
      city: row.delivery_city,
      method: row.fulfillment_method,
      notes: row.delivery_notes,
      region: row.delivery_region,
    } : null,
    id: row.id,
    saleId: row.sale_id,
    shippingFeeCents: Number(row.shipping_fee_cents),
    shippingQuoteSource: row.shipping_quote_source,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapPrescription(row) {
  if (!row?.prescription_id) return null;
  return {
    confirmedData: row.confirmed_data,
    createdAt: row.prescription_created_at,
    extractionProvider: row.extraction_provider,
    extractionStatus: row.extraction_status,
    hasImage: row.source === "IMAGE",
    id: row.prescription_id,
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    source: row.source,
    status: row.prescription_status,
    updatedAt: row.prescription_updated_at,
  };
}

async function loadCart(client, tokenHash, accountId = null) {
  const result = await client.query(
    `SELECT store_carts.*,
            external_prescriptions.id AS prescription_id,
            external_prescriptions.source,
            external_prescriptions.status AS prescription_status,
            external_prescriptions.original_filename,
            external_prescriptions.media_type,
            external_prescriptions.extraction_status,
            external_prescriptions.extraction_provider,
            external_prescriptions.confirmed_data,
            external_prescriptions.created_at AS prescription_created_at,
            external_prescriptions.updated_at AS prescription_updated_at
     FROM store_carts
     LEFT JOIN external_prescriptions
       ON external_prescriptions.cart_id = store_carts.id
     WHERE store_carts.token_hash = $1
       AND (
         store_carts.customer_account_id IS NULL
         OR store_carts.customer_account_id = $2
       )`,
    [tokenHash, accountId],
  );
  const base = mapCartBase(result.rows[0]);
  if (!base) return null;
  const itemsResult = await client.query(
    `SELECT store_cart_items.product_id, store_cart_items.quantity,
            products.sku, products.name, products.category,
            products.requires_prescription, products.unit_price_cents,
            products.is_active
     FROM store_cart_items
     JOIN products ON products.id = store_cart_items.product_id
     WHERE store_cart_items.cart_id = $1
     ORDER BY store_cart_items.created_at, store_cart_items.id`,
    [base.id],
  );
  const items = itemsResult.rows.map((row) => ({
    availability: {
      available: row.is_active,
      exactQuantityKnown: false,
      source: "MOCK",
    },
    category: row.category,
    lineTotalCents: Number(row.unit_price_cents) * row.quantity,
    name: row.name,
    productId: row.product_id,
    quantity: row.quantity,
    requiresPrescription: row.requires_prescription,
    sku: row.sku,
    unitPriceCents: Number(row.unit_price_cents),
  }));
  const subtotalCents = items.reduce((total, item) => total + item.lineTotalCents, 0);
  return {
    ...base,
    externalPrescription: mapPrescription(result.rows[0]),
    items,
    subtotalCents,
    totalCents: subtotalCents + base.shippingFeeCents,
  };
}

export async function createOrRotateStoreCart(tokenHash, accountId, expiresAt) {
  return executeTransaction(async (client) => {
    let cartId = null;
    if (accountId) {
      const existing = await client.query(
        `SELECT id FROM store_carts
         WHERE customer_account_id = $1 AND status = 'ACTIVE'
         FOR UPDATE`,
        [accountId],
      );
      cartId = existing.rows[0]?.id ?? null;
    }
    if (cartId) {
      await client.query(
        `UPDATE store_carts SET token_hash = $2, expires_at = $3
         WHERE id = $1`,
        [cartId, tokenHash, expiresAt],
      );
    } else {
      const result = await client.query(
        `INSERT INTO store_carts (token_hash, customer_account_id, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [tokenHash, accountId, expiresAt],
      );
      cartId = result.rows[0].id;
    }
    return loadCart(client, tokenHash, accountId);
  });
}

export async function findStoreCart(tokenHash, accountId = null) {
  return loadCart({ query: (text, parameters) => executeQuery(text, parameters) }, tokenHash, accountId);
}

async function lockActiveCart(client, tokenHash, accountId) {
  const result = await client.query(
    `SELECT * FROM store_carts
     WHERE token_hash = $1
       AND (customer_account_id IS NULL OR customer_account_id = $2)
     FOR UPDATE`,
    [tokenHash, accountId],
  );
  const cart = result.rows[0];
  if (!cart) return { cart: null, reason: "CART_NOT_FOUND" };
  if (cart.status !== "ACTIVE" || cart.expires_at <= new Date()) {
    return { cart: null, reason: "CART_NOT_ACTIVE" };
  }
  return { cart, reason: null };
}

export async function upsertStoreCartItem(tokenHash, accountId, productId, quantity) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const product = await client.query(
      "SELECT id, is_active FROM products WHERE id = $1 FOR SHARE",
      [productId],
    );
    if (!product.rows[0]?.is_active) return { cart: null, reason: "PRODUCT_NOT_AVAILABLE" };
    await client.query(
      `INSERT INTO store_cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = EXCLUDED.quantity`,
      [locked.cart.id, productId, quantity],
    );
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function removeStoreCartItem(tokenHash, accountId, productId) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const result = await client.query(
      "DELETE FROM store_cart_items WHERE cart_id = $1 AND product_id = $2 RETURNING id",
      [locked.cart.id, productId],
    );
    if (result.rowCount === 0) return { cart: null, reason: "CART_ITEM_NOT_FOUND" };
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function configureStoreCart(tokenHash, accountId, configuration) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    if (configuration.clinicalPrescriptionId && !accountId) {
      return { cart: null, reason: "ACCOUNT_REQUIRED_FOR_PRESCRIPTION" };
    }
    if (configuration.clinicalPrescriptionId) {
      const prescription = await client.query(
        `SELECT optical_prescriptions.id
         FROM customer_accounts
         JOIN customers ON customers.id = customer_accounts.customer_id
         JOIN clinical_encounters ON clinical_encounters.patient_id = customers.patient_id
         JOIN optical_prescriptions
           ON optical_prescriptions.encounter_id = clinical_encounters.id
         WHERE customer_accounts.id = $1
           AND optical_prescriptions.id = $2
           AND optical_prescriptions.status = 'ACTIVE'
           AND clinical_encounters.status = 'FINALIZED'`,
        [accountId, configuration.clinicalPrescriptionId],
      );
      if (prescription.rowCount === 0) {
        return { cart: null, reason: "CLINICAL_PRESCRIPTION_NOT_AVAILABLE" };
      }
    }
    const { buyer, fulfillment } = configuration;
    await client.query(
      `UPDATE store_carts SET
         buyer_rut = $2, buyer_first_names = $3, buyer_last_names = $4,
         buyer_phone = $5, buyer_email = $6, buyer_address = $7,
         fulfillment_method = $8, delivery_address = $9,
         delivery_city = $10, delivery_region = $11, delivery_notes = $12,
         shipping_fee_cents = 0,
         shipping_quote_source = CASE
           WHEN $8::VARCHAR = 'DELIVERY' THEN 'MOCK'
           ELSE NULL
         END,
         clinical_prescription_id = $13
       WHERE id = $1`,
      [locked.cart.id, buyer.rut, buyer.firstNames, buyer.lastNames,
        buyer.phone, buyer.email, buyer.address, fulfillment.method,
        fulfillment.address, fulfillment.city, fulfillment.region,
        fulfillment.notes, configuration.clinicalPrescriptionId],
    );
    if (configuration.clinicalPrescriptionId) {
      await client.query("DELETE FROM external_prescriptions WHERE cart_id = $1", [locked.cart.id]);
    }
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function saveManualExternalPrescription(tokenHash, accountId, data, confirmedAt) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    await client.query(
      `INSERT INTO external_prescriptions (
         cart_id, source, status, extraction_status, confirmed_data, confirmed_at
       ) VALUES ($1, 'MANUAL', 'READY', 'NOT_REQUESTED', $2::JSONB, $3)
       ON CONFLICT (cart_id) DO UPDATE SET
         source = 'MANUAL', status = 'READY', original_filename = NULL,
         media_type = NULL, file_size_bytes = NULL, file_sha256 = NULL,
         file_data = NULL, extraction_status = 'NOT_REQUESTED',
         extraction_provider = NULL, extracted_data = NULL,
         confirmed_data = EXCLUDED.confirmed_data,
         confirmed_at = EXCLUDED.confirmed_at`,
      [locked.cart.id, JSON.stringify(data), confirmedAt],
    );
    await client.query(
      "UPDATE store_carts SET clinical_prescription_id = NULL WHERE id = $1",
      [locked.cart.id],
    );
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function saveExternalPrescriptionImage(tokenHash, accountId, image) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    await client.query(
      `INSERT INTO external_prescriptions (
         cart_id, source, status, original_filename, media_type,
         file_size_bytes, file_sha256, file_data, extraction_status
       ) VALUES ($1, 'IMAGE', 'DRAFT', $2, $3, $4, $5, $6, 'NOT_CONFIGURED')
       ON CONFLICT (cart_id) DO UPDATE SET
         source = 'IMAGE', status = 'DRAFT', original_filename = EXCLUDED.original_filename,
         media_type = EXCLUDED.media_type, file_size_bytes = EXCLUDED.file_size_bytes,
         file_sha256 = EXCLUDED.file_sha256, file_data = EXCLUDED.file_data,
         extraction_status = 'NOT_CONFIGURED', extraction_provider = NULL,
         extracted_data = NULL, confirmed_data = NULL, confirmed_at = NULL`,
      [locked.cart.id, image.filename, image.mediaType, image.size, image.sha256, image.data],
    );
    await client.query(
      "UPDATE store_carts SET clinical_prescription_id = NULL WHERE id = $1",
      [locked.cart.id],
    );
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function confirmExternalPrescription(tokenHash, accountId, data, confirmedAt) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const result = await client.query(
      `UPDATE external_prescriptions
       SET status = 'READY', confirmed_data = $2::JSONB, confirmed_at = $3
       WHERE cart_id = $1 AND source = 'IMAGE' RETURNING id`,
      [locked.cart.id, JSON.stringify(data), confirmedAt],
    );
    if (result.rowCount === 0) return { cart: null, reason: "PRESCRIPTION_IMAGE_NOT_FOUND" };
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function findCartPrescriptionImage(tokenHash, accountId) {
  const result = await executeQuery(
    `SELECT external_prescriptions.original_filename,
            external_prescriptions.media_type, external_prescriptions.file_data
     FROM store_carts
     JOIN external_prescriptions ON external_prescriptions.cart_id = store_carts.id
     WHERE store_carts.token_hash = $1
       AND (store_carts.customer_account_id IS NULL OR store_carts.customer_account_id = $2)
       AND external_prescriptions.source = 'IMAGE'`,
    [tokenHash, accountId],
  );
  const row = result.rows[0];
  return row ? { data: row.file_data, filename: row.original_filename, mediaType: row.media_type } : null;
}

async function ensureGuestCustomer(client, buyer) {
  const result = await client.query(
    `INSERT INTO customers (
       rut, first_names, last_names, phone, email, address, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
     ON CONFLICT (rut) DO NOTHING RETURNING id`,
    [buyer.rut, buyer.firstNames, buyer.lastNames, buyer.phone, buyer.email, buyer.address],
  );
  if (result.rows[0]) return result.rows[0].id;
  const existing = await client.query("SELECT id FROM customers WHERE rut = $1", [buyer.rut]);
  return existing.rows[0].id;
}

export async function checkoutStoreCart(tokenHash, accountId, checkedOutAt) {
  return executeTransaction(async (client) => {
    const result = await client.query(
      `SELECT store_carts.*, external_prescriptions.id AS external_prescription_id,
              external_prescriptions.status AS external_prescription_status
       FROM store_carts
       LEFT JOIN external_prescriptions ON external_prescriptions.cart_id = store_carts.id
       WHERE store_carts.token_hash = $1
         AND (store_carts.customer_account_id IS NULL OR store_carts.customer_account_id = $2)
       FOR UPDATE OF store_carts`,
      [tokenHash, accountId],
    );
    const cart = result.rows[0];
    if (!cart) return { reason: "CART_NOT_FOUND", saleId: null };
    if (cart.status === "CHECKED_OUT") return { reason: null, saleId: cart.sale_id };
    if (cart.status !== "ACTIVE" || cart.expires_at <= checkedOutAt) {
      return { reason: "CART_NOT_ACTIVE", saleId: null };
    }
    const requiredBuyerFields = [
      "buyer_rut", "buyer_first_names", "buyer_last_names", "buyer_phone",
      "buyer_email", "buyer_address", "fulfillment_method",
    ];
    if (requiredBuyerFields.some((field) => !cart[field])) {
      return { reason: "CART_CONFIGURATION_REQUIRED", saleId: null };
    }
    const itemsResult = await client.query(
      `SELECT store_cart_items.product_id, store_cart_items.quantity,
              products.sku, products.name, products.category,
              products.requires_prescription, products.unit_price_cents,
              products.is_active
       FROM store_cart_items JOIN products ON products.id = store_cart_items.product_id
       WHERE store_cart_items.cart_id = $1 FOR SHARE OF products`,
      [cart.id],
    );
    if (itemsResult.rowCount === 0) return { reason: "CART_EMPTY", saleId: null };
    if (itemsResult.rows.some((item) => !item.is_active)) {
      return { reason: "PRODUCT_NOT_AVAILABLE", saleId: null };
    }
    if (itemsResult.rows.some((item) => item.requires_prescription)) {
      const externalReady = cart.external_prescription_id
        && cart.external_prescription_status === "READY";
      if (!cart.clinical_prescription_id && !externalReady) {
        return { reason: "PRESCRIPTION_REQUIRED", saleId: null };
      }
    }
    let customerId;
    if (accountId) {
      const account = await client.query(
        "SELECT customer_id FROM customer_accounts WHERE id = $1 FOR SHARE",
        [accountId],
      );
      customerId = account.rows[0]?.customer_id;
      if (!customerId) return { reason: "CUSTOMER_ACCOUNT_NOT_FOUND", saleId: null };
    } else {
      customerId = await ensureGuestCustomer(client, {
        address: cart.buyer_address,
        email: cart.buyer_email,
        firstNames: cart.buyer_first_names,
        lastNames: cart.buyer_last_names,
        phone: cart.buyer_phone,
        rut: cart.buyer_rut,
      });
    }
    const subtotalCents = itemsResult.rows.reduce(
      (sum, item) => sum + Number(item.unit_price_cents) * item.quantity,
      0,
    );
    const totalCents = subtotalCents + Number(cart.shipping_fee_cents);
    const saleResult = await client.query(
      `INSERT INTO sales (
         customer_id, prescription_id, external_prescription_id, status,
         subtotal_cents, shipping_fee_cents, total_cents, origin,
         fulfillment_method, delivery_address, delivery_city, delivery_region,
         delivery_notes, shipping_quote_source, created_by, updated_by
       ) VALUES (
         $1, $2, $3, 'PENDING', $4, $5, $6, 'ONLINE',
         $7, $8, $9, $10, $11, $12, NULL, NULL
       ) RETURNING id`,
      [customerId, cart.clinical_prescription_id, cart.external_prescription_id,
        subtotalCents, cart.shipping_fee_cents, totalCents, cart.fulfillment_method,
        cart.delivery_address, cart.delivery_city, cart.delivery_region,
        cart.delivery_notes, cart.shipping_quote_source],
    );
    const saleId = saleResult.rows[0].id;
    for (const [index, item] of itemsResult.rows.entries()) {
      await client.query(
        `INSERT INTO sale_items (
           sale_id, product_id, product_sku, product_name, product_category,
           requires_prescription, position, quantity, unit_price_cents
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [saleId, item.product_id, item.sku, item.name, item.category,
          item.requires_prescription, index + 1, item.quantity, item.unit_price_cents],
      );
    }
    await client.query(
      `INSERT INTO sale_events (
         sale_id, event_type, new_status, details, performed_by
       ) VALUES ($1, 'CREATED', 'PENDING', $2, NULL)`,
      [saleId, JSON.stringify({ origin: "ONLINE", totalCents })],
    );
    await client.query(
      `UPDATE store_carts
       SET status = 'CHECKED_OUT', sale_id = $2, checked_out_at = $3
       WHERE id = $1`,
      [cart.id, saleId, checkedOutAt],
    );
    return { reason: null, saleId };
  });
}

export async function listStoreOrders(accountId) {
  const result = await executeQuery(
    `SELECT store_carts.token_hash, store_carts.sale_id
     FROM store_carts
     WHERE customer_account_id = $1 AND status = 'CHECKED_OUT'
     ORDER BY checked_out_at DESC`,
    [accountId],
  );
  return result.rows.map((row) => row.sale_id);
}

export async function findExternalPrescriptionById(prescriptionId) {
  const result = await executeQuery(
    `SELECT id, source, status, original_filename, media_type, file_size_bytes,
            file_sha256, extraction_status, extraction_provider,
            extracted_data, confirmed_data, confirmed_at, created_at, updated_at
     FROM external_prescriptions WHERE id = $1`,
    [prescriptionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    confirmedAt: row.confirmed_at,
    confirmedData: row.confirmed_data,
    createdAt: row.created_at,
    extractedData: row.extracted_data,
    extractionProvider: row.extraction_provider,
    extractionStatus: row.extraction_status,
    fileSha256: row.file_sha256,
    fileSizeBytes: row.file_size_bytes,
    hasImage: row.source === "IMAGE",
    id: row.id,
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    source: row.source,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export async function findExternalPrescriptionFileById(prescriptionId) {
  const result = await executeQuery(
    `SELECT original_filename, media_type, file_data
     FROM external_prescriptions
     WHERE id = $1 AND source = 'IMAGE'`,
    [prescriptionId],
  );
  const row = result.rows[0];
  return row ? { data: row.file_data, filename: row.original_filename, mediaType: row.media_type } : null;
}
