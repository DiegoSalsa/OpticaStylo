import { executeQuery, executeTransaction } from "../db/query.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

const TEST_DATA_AVAILABLE = process.env.NODE_ENV !== "production";

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
    extractedData: row.extracted_data,
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
            external_prescriptions.extracted_data,
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
            store_cart_items.mounted_on_product_id,
            products.sku, products.name, products.category,
            products.requires_prescription, products.unit_price_cents,
            products.is_active, products.is_test_data
     FROM store_cart_items
     JOIN products ON products.id = store_cart_items.product_id
     WHERE store_cart_items.cart_id = $1
     ORDER BY store_cart_items.created_at, store_cart_items.id`,
    [base.id],
  );
  const items = itemsResult.rows.map((row) => ({
    availability: {
      available: row.is_active && (TEST_DATA_AVAILABLE || !row.is_test_data),
      exactQuantityKnown: false,
      source: "MOCK",
    },
    category: row.category,
    lineTotalCents: Number(row.unit_price_cents) * row.quantity,
    mountFrameProductId: row.mounted_on_product_id,
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

export async function upsertStoreCartItem(
  tokenHash,
  accountId,
  productId,
  quantity,
  mountFrameProductId = null,
) {
  return upsertStoreCartItems(tokenHash, accountId, [{
    mountFrameProductId,
    productId,
    quantity,
  }]);
}

export async function upsertStoreCartItems(tokenHash, accountId, items) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const productIds = [...new Set(items.flatMap((item) => [
      item.productId,
      item.mountFrameProductId,
    ].filter(Boolean)))];
    const productResult = await client.query(
      `SELECT id, category, is_active, is_test_data
       FROM products WHERE id = ANY($1::UUID[]) FOR SHARE`,
      [productIds],
    );
    const products = new Map(productResult.rows.map((product) => [product.id, product]));
    if (
      productResult.rowCount !== productIds.length
      || productResult.rows.some((product) => (
        !product.is_active || (!TEST_DATA_AVAILABLE && product.is_test_data)
      ))
    ) return { cart: null, reason: "PRODUCT_NOT_AVAILABLE" };
    const currentFrames = await client.query(
      `SELECT store_cart_items.product_id
       FROM store_cart_items
       JOIN products ON products.id = store_cart_items.product_id
       WHERE store_cart_items.cart_id = $1 AND products.category = 'FRAME'
       FOR SHARE OF store_cart_items, products`,
      [locked.cart.id],
    );
    const frameProductIds = new Set([
      ...currentFrames.rows.map((frame) => frame.product_id),
      ...items
        .filter((item) => products.get(item.productId)?.category === "FRAME")
        .map((item) => item.productId),
    ]);
    for (const item of items) {
      const product = products.get(item.productId);
      if (product.category !== "PRESCRIPTION_LENS") {
        if (item.mountFrameProductId) {
          return { cart: null, reason: "UNEXPECTED_LENS_MOUNT" };
        }
        continue;
      }
      const frame = products.get(item.mountFrameProductId);
      if (
        !item.mountFrameProductId
        || frame?.category !== "FRAME"
        || !frameProductIds.has(item.mountFrameProductId)
      ) {
        return { cart: null, reason: "LENS_MOUNT_REQUIRED" };
      }
    }
    for (const item of items) {
      await client.query(
        `INSERT INTO store_cart_items (
           cart_id, product_id, quantity, mounted_on_product_id
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (cart_id, product_id)
         DO UPDATE SET quantity = EXCLUDED.quantity,
                       mounted_on_product_id = EXCLUDED.mounted_on_product_id`,
        [locked.cart.id, item.productId, item.quantity, item.mountFrameProductId],
      );
    }
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
    await client.query(
      `DELETE FROM store_cart_items
       WHERE cart_id = $1 AND mounted_on_product_id = $2`,
      [locked.cart.id, productId],
    );
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
      const external = await client.query(
        `SELECT cloudinary_asset_id, cloudinary_public_id, cloudinary_version, cloudinary_format
         FROM external_prescriptions WHERE cart_id = $1 FOR UPDATE`,
        [locked.cart.id],
      );
      const removedCloudinary = cloudinaryAsset(external.rows[0]);
      await client.query("DELETE FROM external_prescriptions WHERE cart_id = $1", [locked.cart.id]);
      return {
        cart: await loadCart(client, tokenHash, accountId),
        reason: null,
        removedCloudinary,
      };
    }
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function saveManualExternalPrescription(tokenHash, accountId, data, confirmedAt) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const existing = await client.query(
      `SELECT cloudinary_asset_id, cloudinary_public_id, cloudinary_version, cloudinary_format
       FROM external_prescriptions WHERE cart_id = $1 FOR UPDATE`,
      [locked.cart.id],
    );
    const replacedCloudinary = cloudinaryAsset(existing.rows[0]);
    await client.query(
      `INSERT INTO external_prescriptions (
         cart_id, source, status, extraction_status, confirmed_data, confirmed_at
       ) VALUES ($1, 'MANUAL', 'READY', 'NOT_REQUESTED', $2::JSONB, $3)
       ON CONFLICT (cart_id) DO UPDATE SET
         source = 'MANUAL', status = 'READY', original_filename = NULL,
         media_type = NULL, file_size_bytes = NULL, file_sha256 = NULL,
         file_data = NULL, cloudinary_asset_id = NULL, cloudinary_public_id = NULL,
         cloudinary_version = NULL, cloudinary_format = NULL, extraction_status = 'NOT_REQUESTED',
         extraction_provider = NULL, extracted_data = NULL,
         confirmed_data = EXCLUDED.confirmed_data,
         confirmed_at = EXCLUDED.confirmed_at`,
      [locked.cart.id, JSON.stringify(data), confirmedAt],
    );
    await client.query(
      "UPDATE store_carts SET clinical_prescription_id = NULL WHERE id = $1",
      [locked.cart.id],
    );
    return { cart: await loadCart(client, tokenHash, accountId), reason: null, replacedCloudinary };
  });
}

export async function saveExternalPrescriptionImage(tokenHash, accountId, image) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const existing = await client.query(
      `SELECT cloudinary_asset_id, cloudinary_public_id, cloudinary_version, cloudinary_format
       FROM external_prescriptions WHERE cart_id = $1 FOR UPDATE`,
      [locked.cart.id],
    );
    const replacedCloudinary = cloudinaryAsset(existing.rows[0]);
    await client.query(
      `INSERT INTO external_prescriptions (
         cart_id, source, status, original_filename, media_type,
         file_size_bytes, file_sha256, file_data, cloudinary_asset_id,
         cloudinary_public_id, cloudinary_version, cloudinary_format, extraction_status
       ) VALUES ($1, 'IMAGE', 'DRAFT', $2, $3, $4, $5, NULL, $6, $7, $8, $9, 'NOT_REQUESTED')
       ON CONFLICT (cart_id) DO UPDATE SET
         source = 'IMAGE', status = 'DRAFT', original_filename = EXCLUDED.original_filename,
         media_type = EXCLUDED.media_type, file_size_bytes = EXCLUDED.file_size_bytes,
         file_sha256 = EXCLUDED.file_sha256, file_data = NULL,
         cloudinary_asset_id = EXCLUDED.cloudinary_asset_id,
         cloudinary_public_id = EXCLUDED.cloudinary_public_id,
         cloudinary_version = EXCLUDED.cloudinary_version,
         cloudinary_format = EXCLUDED.cloudinary_format,
         extraction_status = 'NOT_REQUESTED', extraction_provider = NULL,
         extracted_data = NULL, confirmed_data = NULL, confirmed_at = NULL`,
      [locked.cart.id, image.filename, image.mediaType, image.size, image.sha256,
        image.cloudinary.assetId, image.cloudinary.publicId, image.cloudinary.version,
        image.cloudinary.format],
    );
    await client.query(
      "UPDATE store_carts SET clinical_prescription_id = NULL WHERE id = $1",
      [locked.cart.id],
    );
    return { cart: await loadCart(client, tokenHash, accountId), reason: null, replacedCloudinary };
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

export async function claimCartPrescriptionExtraction(tokenHash, accountId, provider) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const result = await client.query(
      `SELECT original_filename, media_type, file_data, cloudinary_asset_id,
              cloudinary_public_id, cloudinary_version, cloudinary_format,
              extraction_status, extraction_provider, extracted_data
       FROM external_prescriptions
       WHERE cart_id = $1 AND source = 'IMAGE'
       FOR UPDATE`,
      [locked.cart.id],
    );
    const prescription = result.rows[0];
    if (!prescription) return { cart: null, reason: "PRESCRIPTION_IMAGE_NOT_FOUND" };
    if (prescription.extraction_status === "PENDING") {
      return { cart: null, reason: "PRESCRIPTION_EXTRACTION_IN_PROGRESS" };
    }
    if (prescription.extraction_status === "COMPLETED" && prescription.extracted_data) {
      return {
        cart: await loadCart(client, tokenHash, accountId),
        cached: true,
        data: prescription.extracted_data,
        provider: prescription.extraction_provider,
        reason: null,
      };
    }
    await client.query(
      `UPDATE external_prescriptions
       SET extraction_status = 'PENDING', extraction_provider = $2, extracted_data = NULL
       WHERE cart_id = $1`,
      [locked.cart.id, provider],
    );
    return {
      cached: false,
      image: {
        cloudinary: cloudinaryAsset(prescription),
        data: prescription.file_data,
        filename: prescription.original_filename,
        mediaType: prescription.media_type,
      },
      reason: null,
    };
  });
}

export async function completeCartPrescriptionExtraction(
  tokenHash,
  accountId,
  provider,
  data,
) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const result = await client.query(
      `UPDATE external_prescriptions
       SET extraction_status = 'COMPLETED', extraction_provider = $2, extracted_data = $3::JSONB
       WHERE cart_id = $1 AND source = 'IMAGE' AND extraction_status = 'PENDING'
       RETURNING id`,
      [locked.cart.id, provider, JSON.stringify(data)],
    );
    if (result.rowCount === 0) return { cart: null, reason: "PRESCRIPTION_IMAGE_NOT_FOUND" };
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function failCartPrescriptionExtraction(tokenHash, accountId, provider) {
  return executeTransaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { reason: locked.reason };
    await client.query(
      `UPDATE external_prescriptions
       SET extraction_status = 'FAILED', extraction_provider = $2, extracted_data = NULL
       WHERE cart_id = $1 AND source = 'IMAGE' AND extraction_status = 'PENDING'`,
      [locked.cart.id, provider],
    );
    return { reason: null };
  });
}

export async function findCartPrescriptionImage(tokenHash, accountId) {
  const result = await executeQuery(
    `SELECT external_prescriptions.original_filename, external_prescriptions.media_type,
            external_prescriptions.file_data, external_prescriptions.cloudinary_asset_id,
            external_prescriptions.cloudinary_public_id,
            external_prescriptions.cloudinary_version, external_prescriptions.cloudinary_format
     FROM store_carts
     JOIN external_prescriptions ON external_prescriptions.cart_id = store_carts.id
     WHERE store_carts.token_hash = $1
       AND (store_carts.customer_account_id IS NULL OR store_carts.customer_account_id = $2)
       AND external_prescriptions.source = 'IMAGE'`,
    [tokenHash, accountId],
  );
  const row = result.rows[0];
  return row ? {
    cloudinary: row.cloudinary_asset_id ? {
      assetId: row.cloudinary_asset_id,
      format: row.cloudinary_format,
      publicId: row.cloudinary_public_id,
      version: Number(row.cloudinary_version),
    } : null,
    data: row.file_data,
    filename: row.original_filename,
    mediaType: row.media_type,
  } : null;
}

function cloudinaryAsset(row) {
  if (!row?.cloudinary_asset_id) return null;
  return {
    assetId: row.cloudinary_asset_id,
    format: row.cloudinary_format,
    publicId: row.cloudinary_public_id,
    version: Number(row.cloudinary_version),
  };
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
              store_cart_items.mounted_on_product_id,
              products.sku, products.name, products.category,
              products.requires_prescription, products.unit_price_cents,
              products.is_active, products.is_test_data
       FROM store_cart_items JOIN products ON products.id = store_cart_items.product_id
       WHERE store_cart_items.cart_id = $1 FOR SHARE OF products`,
      [cart.id],
    );
    if (itemsResult.rowCount === 0) return { reason: "CART_EMPTY", saleId: null };
    if (itemsResult.rows.some((item) => (
      !item.is_active || (!TEST_DATA_AVAILABLE && item.is_test_data)
    ))) {
      return { reason: "PRODUCT_NOT_AVAILABLE", saleId: null };
    }
    const frameProductIds = new Set(
      itemsResult.rows
        .filter((item) => item.category === "FRAME")
        .map((item) => item.product_id),
    );
    if (itemsResult.rows.some((item) => (
      item.category === "PRESCRIPTION_LENS"
      && (
        !item.mounted_on_product_id
        || !frameProductIds.has(item.mounted_on_product_id)
      )
    ))) {
      return { reason: "LENS_MOUNT_REQUIRED", saleId: null };
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
       ) RETURNING id, sale_number`,
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
           requires_prescription, mount_source, mounted_on_product_id,
           position, quantity, unit_price_cents
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [saleId, item.product_id, item.sku, item.name, item.category,
          item.requires_prescription,
          item.category === "PRESCRIPTION_LENS" ? "SOLD_FRAME" : null,
          item.category === "PRESCRIPTION_LENS" ? item.mounted_on_product_id : null,
          index + 1, item.quantity, item.unit_price_cents],
      );
    }
    await client.query(
      `INSERT INTO sale_events (
         sale_id, event_type, new_status, details, performed_by
       ) VALUES ($1, 'CREATED', 'PENDING', $2, NULL)`,
      [saleId, JSON.stringify({ origin: "ONLINE", totalCents })],
    );
    await client.query(
      `INSERT INTO transactional_email_outbox (
         template_code, recipient_email, payload, deduplication_key, sale_id
       ) VALUES ('ORDER_CONFIRMED', $1, $2::JSONB, $3, $4)
       ON CONFLICT (deduplication_key) DO NOTHING`,
      [cart.buyer_email, JSON.stringify({
        saleNumber: Number(saleResult.rows[0].sale_number),
        totalCents,
      }), transactionalEmailDeduplicationKey("ORDER_CONFIRMED", saleId), saleId],
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
    `SELECT original_filename, media_type, file_data, cloudinary_asset_id,
            cloudinary_public_id, cloudinary_version, cloudinary_format
     FROM external_prescriptions
     WHERE id = $1 AND source = 'IMAGE'`,
    [prescriptionId],
  );
  const row = result.rows[0];
  return row ? {
    cloudinary: cloudinaryAsset(row),
    data: row.file_data,
    filename: row.original_filename,
    mediaType: row.media_type,
  } : null;
}
