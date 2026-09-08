import { prisma } from "../db/prisma.js";
import { cartHasReadyPrescription } from "../utils/prescription-requirement.js";
import { canUseStoreTestData } from "../utils/store-test-data.js";
import { transactionalEmailDeduplicationKey } from "../utils/transactional-email-key.js";

const TEST_DATA_AVAILABLE = canUseStoreTestData();
const itemProduct = "products_store_cart_items_product_idToproducts";

function mapPrescription(row) {
  if (!row) return null;
  return {
    confirmedData: row.confirmed_data, createdAt: row.created_at,
    extractedData: row.extracted_data, extractionProvider: row.extraction_provider,
    extractionStatus: row.extraction_status, hasImage: row.source === "IMAGE",
    id: row.id, mediaType: row.media_type, originalFilename: row.original_filename,
    source: row.source, status: row.status, updatedAt: row.updated_at,
  };
}

function mapCartBase(row) {
  if (!row) return null;
  return {
    buyer: row.buyer_rut ? {
      address: row.buyer_address, email: row.buyer_email,
      firstNames: row.buyer_first_names, lastNames: row.buyer_last_names,
      phone: row.buyer_phone, rut: row.buyer_rut,
    } : null,
    checkedOutAt: row.checked_out_at, clinicalPrescriptionId: row.clinical_prescription_id,
    createdAt: row.created_at, customerAccountId: row.customer_account_id,
    expiresAt: row.expires_at,
    fulfillment: row.fulfillment_method ? {
      address: row.delivery_address, city: row.delivery_city,
      method: row.fulfillment_method, notes: row.delivery_notes, region: row.delivery_region,
    } : null,
    id: row.id, saleId: row.sale_id, shippingFeeCents: Number(row.shipping_fee_cents),
    shippingQuoteSource: row.shipping_quote_source, status: row.status, updatedAt: row.updated_at,
  };
}

const cartInclude = {
  external_prescriptions: true,
  store_cart_items: {
    include: { [itemProduct]: true },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  },
};

async function loadCart(client, tokenHash, accountId = null) {
  const row = await client.store_carts.findFirst({
    include: cartInclude,
    where: {
      token_hash: tokenHash,
      OR: [{ customer_account_id: null }, { customer_account_id: accountId }],
    },
  });
  const base = mapCartBase(row);
  if (!base) return null;
  const items = row.store_cart_items.map((item) => {
    const product = item[itemProduct];
    return {
      availability: {
        available: product.is_active && (TEST_DATA_AVAILABLE || !product.is_test_data),
        exactQuantityKnown: false, source: "MOCK",
      },
      category: product.category,
      lineTotalCents: Number(product.unit_price_cents) * item.quantity,
      mountFrameProductId: item.mounted_on_product_id, name: product.name,
      productId: item.product_id, quantity: item.quantity,
      requiresPrescription: product.requires_prescription, sku: product.sku,
      unitPriceCents: Number(product.unit_price_cents),
    };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  return {
    ...base, externalPrescription: mapPrescription(row.external_prescriptions), items,
    subtotalCents, totalCents: subtotalCents + base.shippingFeeCents,
  };
}

async function lockActiveCart(client, tokenHash, accountId) {
  const cart = await client.store_carts.findFirst({
    where: { token_hash: tokenHash, OR: [{ customer_account_id: null }, { customer_account_id: accountId }] },
  });
  if (!cart) return { cart: null, reason: "CART_NOT_FOUND" };
  if (cart.status !== "ACTIVE" || cart.expires_at <= new Date()) return { cart: null, reason: "CART_NOT_ACTIVE" };
  return { cart, reason: null };
}

export async function createOrRotateStoreCart(tokenHash, accountId, expiresAt) {
  return prisma.$transaction(async (client) => {
    const existing = accountId ? await client.store_carts.findFirst({
      where: { customer_account_id: accountId, status: "ACTIVE" },
    }) : null;
    if (existing) {
      await client.store_carts.update({ data: { expires_at: expiresAt, token_hash: tokenHash }, where: { id: existing.id } });
    } else {
      await client.store_carts.create({ data: { customer_account_id: accountId, expires_at: expiresAt, token_hash: tokenHash } });
    }
    return loadCart(client, tokenHash, accountId);
  }, { isolationLevel: "Serializable" });
}

export async function findStoreCart(tokenHash, accountId = null) {
  return loadCart(prisma, tokenHash, accountId);
}

export async function upsertStoreCartItem(tokenHash, accountId, productId, quantity, mountFrameProductId = null) {
  return upsertStoreCartItems(tokenHash, accountId, [{ mountFrameProductId, productId, quantity }]);
}

export async function upsertStoreCartItems(tokenHash, accountId, items) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const productIds = [...new Set(items.flatMap((item) => [item.productId, item.mountFrameProductId].filter(Boolean)))];
    const productRows = await client.products.findMany({ where: { id: { in: productIds } } });
    const products = new Map(productRows.map((product) => [product.id, product]));
    if (productRows.length !== productIds.length || productRows.some((product) => !product.is_active || (!TEST_DATA_AVAILABLE && product.is_test_data))) {
      return { cart: null, reason: "PRODUCT_NOT_AVAILABLE" };
    }
    const currentFrames = await client.store_cart_items.findMany({
      select: { product_id: true },
      where: { cart_id: locked.cart.id, [itemProduct]: { category: "FRAME" } },
    });
    const frameIds = new Set([
      ...currentFrames.map((item) => item.product_id),
      ...items.filter((item) => products.get(item.productId)?.category === "FRAME").map((item) => item.productId),
    ]);
    for (const item of items) {
      const product = products.get(item.productId);
      if (product.category !== "PRESCRIPTION_LENS") {
        if (item.mountFrameProductId) return { cart: null, reason: "UNEXPECTED_LENS_MOUNT" };
      } else if (!item.mountFrameProductId || products.get(item.mountFrameProductId)?.category !== "FRAME" || !frameIds.has(item.mountFrameProductId)) {
        return { cart: null, reason: "LENS_MOUNT_REQUIRED" };
      }
    }
    for (const item of items) await client.store_cart_items.upsert({
      create: {
        cart_id: locked.cart.id, mounted_on_product_id: item.mountFrameProductId,
        product_id: item.productId, quantity: item.quantity,
      },
      update: { mounted_on_product_id: item.mountFrameProductId, quantity: item.quantity },
      where: { cart_id_product_id: { cart_id: locked.cart.id, product_id: item.productId } },
    });
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function removeStoreCartItem(tokenHash, accountId, productId) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const removed = await client.store_cart_items.deleteMany({ where: { cart_id: locked.cart.id, product_id: productId } });
    if (!removed.count) return { cart: null, reason: "CART_ITEM_NOT_FOUND" };
    await client.store_cart_items.deleteMany({ where: { cart_id: locked.cart.id, mounted_on_product_id: productId } });
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

function cloudinaryAsset(row) {
  return row?.cloudinary_asset_id ? {
    assetId: row.cloudinary_asset_id, format: row.cloudinary_format,
    publicId: row.cloudinary_public_id, version: Number(row.cloudinary_version),
  } : null;
}

export async function configureStoreCart(tokenHash, accountId, configuration) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    if (configuration.clinicalPrescriptionId && !accountId) return { cart: null, reason: "ACCOUNT_REQUIRED_FOR_PRESCRIPTION" };
    if (configuration.clinicalPrescriptionId) {
      const account = await client.customer_accounts.findUnique({ include: { customers: true }, where: { id: accountId } });
      const prescription = account?.customers.patient_id ? await client.optical_prescriptions.findFirst({
        where: {
          id: configuration.clinicalPrescriptionId, status: "ACTIVE",
          clinical_encounters: { patient_id: account.customers.patient_id, status: "FINALIZED" },
        },
      }) : null;
      if (!prescription) return { cart: null, reason: "CLINICAL_PRESCRIPTION_NOT_AVAILABLE" };
    }
    const { buyer, fulfillment } = configuration;
    await client.store_carts.update({ data: {
      buyer_address: buyer.address, buyer_email: buyer.email, buyer_first_names: buyer.firstNames,
      buyer_last_names: buyer.lastNames, buyer_phone: buyer.phone, buyer_rut: buyer.rut,
      clinical_prescription_id: configuration.clinicalPrescriptionId,
      delivery_address: fulfillment.address, delivery_city: fulfillment.city,
      delivery_notes: fulfillment.notes, delivery_region: fulfillment.region,
      fulfillment_method: fulfillment.method, shipping_fee_cents: 0,
      shipping_quote_source: fulfillment.method === "DELIVERY" ? "MOCK" : null,
    }, where: { id: locked.cart.id } });
    if (configuration.clinicalPrescriptionId) {
      const external = await client.external_prescriptions.findUnique({ where: { cart_id: locked.cart.id } });
      const removedCloudinary = cloudinaryAsset(external);
      await client.external_prescriptions.deleteMany({ where: { cart_id: locked.cart.id } });
      return { cart: await loadCart(client, tokenHash, accountId), reason: null, removedCloudinary };
    }
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  }, { isolationLevel: "Serializable" });
}

export async function saveManualExternalPrescription(tokenHash, accountId, data, confirmedAt) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const existing = await client.external_prescriptions.findUnique({ where: { cart_id: locked.cart.id } });
    const replacedCloudinary = cloudinaryAsset(existing);
    await client.external_prescriptions.upsert({
      create: {
        cart_id: locked.cart.id, confirmed_at: confirmedAt, confirmed_data: data,
        extraction_status: "NOT_REQUESTED", source: "MANUAL", status: "READY",
      },
      update: {
        cloudinary_asset_id: null, cloudinary_format: null, cloudinary_public_id: null,
        cloudinary_version: null, confirmed_at: confirmedAt, confirmed_data: data,
        extracted_data: null, extraction_provider: null, extraction_status: "NOT_REQUESTED",
        file_data: null, file_sha256: null, file_size_bytes: null, media_type: null,
        original_filename: null, source: "MANUAL", status: "READY",
      },
      where: { cart_id: locked.cart.id },
    });
    await client.store_carts.update({ data: { clinical_prescription_id: null }, where: { id: locked.cart.id } });
    return { cart: await loadCart(client, tokenHash, accountId), reason: null, replacedCloudinary };
  });
}

export async function saveExternalPrescriptionImage(tokenHash, accountId, image) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const existing = await client.external_prescriptions.findUnique({ where: { cart_id: locked.cart.id } });
    const replacedCloudinary = cloudinaryAsset(existing);
    const data = {
      cloudinary_asset_id: image.cloudinary.assetId, cloudinary_format: image.cloudinary.format,
      cloudinary_public_id: image.cloudinary.publicId, cloudinary_version: image.cloudinary.version,
      confirmed_at: null, confirmed_data: null, extracted_data: null,
      extraction_provider: null, extraction_status: "NOT_REQUESTED", file_data: null,
      file_sha256: image.sha256, file_size_bytes: image.size, media_type: image.mediaType,
      original_filename: image.filename, source: "IMAGE", status: "DRAFT",
    };
    await client.external_prescriptions.upsert({
      create: { ...data, cart_id: locked.cart.id }, update: data,
      where: { cart_id: locked.cart.id },
    });
    await client.store_carts.update({ data: { clinical_prescription_id: null }, where: { id: locked.cart.id } });
    return { cart: await loadCart(client, tokenHash, accountId), reason: null, replacedCloudinary };
  });
}

export async function confirmExternalPrescription(tokenHash, accountId, data, confirmedAt) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const updated = await client.external_prescriptions.updateMany({
      data: { confirmed_at: confirmedAt, confirmed_data: data, status: "READY" },
      where: { cart_id: locked.cart.id, source: "IMAGE" },
    });
    if (!updated.count) return { cart: null, reason: "PRESCRIPTION_IMAGE_NOT_FOUND" };
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function claimCartPrescriptionExtraction(tokenHash, accountId, provider) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const prescription = await client.external_prescriptions.findFirst({ where: { cart_id: locked.cart.id, source: "IMAGE" } });
    if (!prescription) return { cart: null, reason: "PRESCRIPTION_IMAGE_NOT_FOUND" };
    if (prescription.extraction_status === "PENDING") return { cart: null, reason: "PRESCRIPTION_EXTRACTION_IN_PROGRESS" };
    if (prescription.extraction_status === "COMPLETED" && prescription.extracted_data) return {
      cart: await loadCart(client, tokenHash, accountId), cached: true,
      data: prescription.extracted_data, provider: prescription.extraction_provider, reason: null,
    };
    await client.external_prescriptions.update({ data: {
      extracted_data: null, extraction_provider: provider, extraction_status: "PENDING",
    }, where: { id: prescription.id } });
    return {
      cached: false,
      image: {
        cloudinary: cloudinaryAsset(prescription), data: prescription.file_data,
        filename: prescription.original_filename, mediaType: prescription.media_type,
      }, reason: null,
    };
  }, { isolationLevel: "Serializable" });
}

export async function completeCartPrescriptionExtraction(tokenHash, accountId, provider, data) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { cart: null, reason: locked.reason };
    const updated = await client.external_prescriptions.updateMany({
      data: { extracted_data: data, extraction_provider: provider, extraction_status: "COMPLETED" },
      where: { cart_id: locked.cart.id, extraction_status: "PENDING", source: "IMAGE" },
    });
    if (!updated.count) return { cart: null, reason: "PRESCRIPTION_IMAGE_NOT_FOUND" };
    return { cart: await loadCart(client, tokenHash, accountId), reason: null };
  });
}

export async function failCartPrescriptionExtraction(tokenHash, accountId, provider) {
  return prisma.$transaction(async (client) => {
    const locked = await lockActiveCart(client, tokenHash, accountId);
    if (locked.reason) return { reason: locked.reason };
    await client.external_prescriptions.updateMany({
      data: { extracted_data: null, extraction_provider: provider, extraction_status: "FAILED" },
      where: { cart_id: locked.cart.id, extraction_status: "PENDING", source: "IMAGE" },
    });
    return { reason: null };
  });
}

export async function findCartPrescriptionImage(tokenHash, accountId) {
  const row = await prisma.external_prescriptions.findFirst({
    where: {
      source: "IMAGE",
      store_carts: { token_hash: tokenHash, OR: [{ customer_account_id: null }, { customer_account_id: accountId }] },
    },
  });
  return row ? {
    cloudinary: cloudinaryAsset(row), data: row.file_data,
    filename: row.original_filename, mediaType: row.media_type,
  } : null;
}

async function ensureGuestCustomer(client, buyer) {
  if (buyer.rut) {
    const existing = await client.customers.findUnique({ where: { rut: buyer.rut } });
    if (existing) return existing.id;
  }
  return (await client.customers.create({ data: {
    address: buyer.address, created_by: null, email: buyer.email,
    first_names: buyer.firstNames, last_names: buyer.lastNames, phone: buyer.phone,
    rut: buyer.rut, updated_by: null,
  } })).id;
}

export async function checkoutStoreCart(tokenHash, accountId, checkedOutAt) {
  return prisma.$transaction(async (client) => {
    const cart = await client.store_carts.findFirst({
      include: cartInclude,
      where: { token_hash: tokenHash, OR: [{ customer_account_id: null }, { customer_account_id: accountId }] },
    });
    if (!cart) return { reason: "CART_NOT_FOUND", saleId: null };
    if (cart.status === "CHECKED_OUT") return { reason: null, saleId: cart.sale_id };
    if (cart.status !== "ACTIVE" || cart.expires_at <= checkedOutAt) return { reason: "CART_NOT_ACTIVE", saleId: null };
    if (["buyer_rut", "buyer_first_names", "buyer_last_names", "buyer_phone", "buyer_email", "buyer_address", "fulfillment_method"].some((field) => !cart[field])) {
      return { reason: "CART_CONFIGURATION_REQUIRED", saleId: null };
    }
    if (!cart.store_cart_items.length) return { reason: "CART_EMPTY", saleId: null };
    const items = cart.store_cart_items.map((item) => ({ ...item, product: item[itemProduct] }));
    if (items.some((item) => !item.product.is_active || (!TEST_DATA_AVAILABLE && item.product.is_test_data))) {
      return { reason: "PRODUCT_NOT_AVAILABLE", saleId: null };
    }
    const frameIds = new Set(items.filter((item) => item.product.category === "FRAME").map((item) => item.product_id));
    if (items.some((item) => item.product.category === "PRESCRIPTION_LENS" && (!item.mounted_on_product_id || !frameIds.has(item.mounted_on_product_id)))) {
      return { reason: "LENS_MOUNT_REQUIRED", saleId: null };
    }
    if (!cartHasReadyPrescription({
      clinicalPrescriptionId: cart.clinical_prescription_id,
      externalPrescriptionStatus: cart.external_prescriptions?.status,
    }, items.map((item) => ({ category: item.product.category, requiresPrescription: item.product.requires_prescription })))) {
      return { reason: "PRESCRIPTION_REQUIRED", saleId: null };
    }
    let customerId;
    if (accountId) {
      customerId = (await client.customer_accounts.findUnique({ where: { id: accountId } }))?.customer_id;
      if (!customerId) return { reason: "CUSTOMER_ACCOUNT_NOT_FOUND", saleId: null };
    } else customerId = await ensureGuestCustomer(client, {
      address: cart.buyer_address, email: cart.buyer_email, firstNames: cart.buyer_first_names,
      lastNames: cart.buyer_last_names, phone: cart.buyer_phone, rut: cart.buyer_rut,
    });
    const subtotalCents = items.reduce((sum, item) => sum + Number(item.product.unit_price_cents) * item.quantity, 0);
    const totalCents = subtotalCents + Number(cart.shipping_fee_cents);
    const sale = await client.sales.create({ data: {
      created_by: null, customer_id: customerId,
      delivery_address: cart.delivery_address, delivery_city: cart.delivery_city,
      delivery_notes: cart.delivery_notes, delivery_region: cart.delivery_region,
      external_prescription_id: cart.external_prescriptions?.id,
      fulfillment_method: cart.fulfillment_method, origin: "ONLINE",
      prescription_id: cart.clinical_prescription_id, shipping_fee_cents: cart.shipping_fee_cents,
      shipping_quote_source: cart.shipping_quote_source, status: "PENDING",
      subtotal_cents: subtotalCents, total_cents: totalCents, updated_by: null,
      sale_items: { create: items.map((item, index) => ({
        mount_source: item.product.category === "PRESCRIPTION_LENS" ? "SOLD_FRAME" : null,
        mounted_on_product_id: item.product.category === "PRESCRIPTION_LENS" ? item.mounted_on_product_id : null,
        position: index + 1, product_category: item.product.category, product_id: item.product_id,
        product_name: item.product.name, product_sku: item.product.sku,
        quantity: item.quantity, requires_prescription: item.product.requires_prescription,
        unit_price_cents: item.product.unit_price_cents,
      })) },
    } });
    await client.sale_events.create({ data: {
      details: JSON.stringify({ origin: "ONLINE", totalCents }), event_type: "CREATED",
      new_status: "PENDING", performed_by: null, sale_id: sale.id,
    } });
    const key = transactionalEmailDeduplicationKey("ORDER_CONFIRMED", sale.id);
    await client.transactional_email_outbox.upsert({
      create: {
        deduplication_key: key, payload: { saleNumber: Number(sale.sale_number), totalCents },
        recipient_email: cart.buyer_email, sale_id: sale.id, template_code: "ORDER_CONFIRMED",
      }, update: {}, where: { deduplication_key: key },
    });
    await client.store_carts.update({ data: {
      checked_out_at: checkedOutAt, sale_id: sale.id, status: "CHECKED_OUT",
    }, where: { id: cart.id } });
    return { reason: null, saleId: sale.id };
  }, { isolationLevel: "Serializable" });
}

export async function listStoreOrders(accountId) {
  return (await prisma.store_carts.findMany({
    orderBy: { checked_out_at: "desc" }, select: { sale_id: true },
    where: { customer_account_id: accountId, status: "CHECKED_OUT" },
  })).map((row) => row.sale_id);
}

export async function findExternalPrescriptionById(prescriptionId) {
  return mapPrescription(await prisma.external_prescriptions.findUnique({ where: { id: prescriptionId } }));
}

export async function findExternalPrescriptionFileById(prescriptionId) {
  const row = await prisma.external_prescriptions.findFirst({ where: { id: prescriptionId, source: "IMAGE" } });
  return row ? { cloudinary: cloudinaryAsset(row), data: row.file_data, filename: row.original_filename, mediaType: row.media_type } : null;
}
