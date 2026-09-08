import { prisma } from "../db/prisma.js";

function mapProduct(row) {
  if (!row) return null;
  return {
    category: row.category, createdAt: row.created_at, id: row.id,
    isActive: row.is_active, isTestData: row.is_test_data, name: row.name,
    requiresPrescription: row.requires_prescription, sku: row.sku,
    unitPriceCents: Number(row.unit_price_cents), updatedAt: row.updated_at,
  };
}

async function insertEvent(client, productId, eventType, changedFields, actorUserId) {
  await client.product_events.create({ data: {
    changed_fields: changedFields,
    event_type: eventType,
    performed_by: actorUserId,
    product_id: productId,
  } });
}

export async function createProduct(product, actorUserId) {
  return prisma.$transaction(async (client) => {
    const created = await client.products.create({ data: {
      category: product.category, created_by: actorUserId, is_active: true,
      name: product.name, requires_prescription: product.requiresPrescription,
      sku: product.sku, unit_price_cents: product.unitPriceCents, updated_by: actorUserId,
    } });
    await insertEvent(client, created.id, "CREATED", [], actorUserId);
    return mapProduct(created);
  });
}

export async function findProductById(productId) {
  return mapProduct(await prisma.products.findUnique({ where: { id: productId } }));
}

export async function listProducts({ category, excludeCategory = null, includeTestData = true, isActive, page, pageSize, search }) {
  const where = {
    ...(category ? { category } : {}),
    ...(excludeCategory ? { NOT: { category: excludeCategory } } : {}),
    ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
    ...(!includeTestData ? { is_test_data: false } : {}),
    ...(search ? { OR: [
      { sku: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ] } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.products.findMany({
      orderBy: [{ is_active: "desc" }, { category: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize, take: pageSize, where,
    }),
    prisma.products.count({ where }),
  ]);
  return { items: items.map(mapProduct), page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0 };
}

export async function updateProduct(productId, product, changedFields, actorUserId) {
  return prisma.$transaction(async (client) => {
    const existing = await client.products.findUnique({ select: { id: true }, where: { id: productId } });
    if (!existing) return null;
    const updated = await client.products.update({ data: {
      category: product.category, is_active: product.isActive, name: product.name,
      requires_prescription: product.requiresPrescription, sku: product.sku,
      unit_price_cents: product.unitPriceCents, updated_by: actorUserId,
    }, where: { id: productId } });
    await insertEvent(client, productId, "UPDATED", changedFields, actorUserId);
    return mapProduct(updated);
  });
}

export async function listProductEvents(productId) {
  const events = await prisma.product_events.findMany({
    orderBy: [{ created_at: "asc" }, { id: "asc" }], where: { product_id: productId },
  });
  return events.map((row) => ({
    changedFields: row.changed_fields, createdAt: row.created_at,
    eventType: row.event_type, id: Number(row.id), performedBy: row.performed_by,
  }));
}
