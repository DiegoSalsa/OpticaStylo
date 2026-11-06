import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { commercialError } from "../validations/customer-commercial-validation.js";
import { normalizeChileanRut } from "../utils/chilean-rut.js";
export const commercialNumber = value => {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) commercialError("El importe excede el rango de representación segura.", "COMMERCIAL_AMOUNT_RANGE", 409);
  return n;
};
export function commercialScope(scope, alias = "f") {
  if (!scope.allowedBranchIds) return Prisma.sql`TRUE`;
  const prefix = Prisma.raw(alias);
  return Prisma.sql`((${scope.allowedBranchIds.length ? Prisma.sql`${prefix}.branch_id IN (${Prisma.join(scope.allowedBranchIds.map(id => Prisma.sql`${id}::uuid`))})` : Prisma.sql`FALSE`}) OR (${prefix}.branch_id IS NULL AND ${prefix}.created_by=${scope.legacyActorId}::uuid))`;
}
const stats = Prisma.sql`count(*) FILTER(WHERE f.is_valid_purchase)::int AS purchase_count,
 COALESCE(sum(f.total_cents) FILTER(WHERE f.is_valid_purchase),0)::text AS total_spent,
 min(f.purchase_at) FILTER(WHERE f.is_valid_purchase) AS first_purchase_at,
 max(f.purchase_at) FILTER(WHERE f.is_valid_purchase) AS last_purchase_at,
 count(*) FILTER(WHERE f.status='QUOTATION' AND (f.quotation_valid_until IS NULL OR f.quotation_valid_until>CURRENT_TIMESTAMP))::int AS quotation_count,
 count(*) FILTER(WHERE f.status IN ('PENDING','PAID','IN_PREPARATION','READY'))::int AS pending_count,
 count(*) FILTER(WHERE f.refund_review)::int AS refund_review_count`;
export function mapCommercialStats(row) {
  const count = Number(row?.purchase_count ?? 0),
    first = row?.first_purchase_at,
    last = row?.last_purchase_at;
  return {
    purchaseCount: count,
    totalSpentCents: commercialNumber(row?.total_spent),
    firstPurchaseAt: first ?? null,
    lastPurchaseAt: last ?? null,
    averageIntervalDays: count > 1 ? Math.round((new Date(last) - new Date(first)) / 86400000 / (count - 1) * 10) / 10 : null,
    quotationCount: Number(row?.quotation_count ?? 0),
    pendingCount: Number(row?.pending_count ?? 0),
    refundReviewCount: Number(row?.refund_review_count ?? 0),
    recurring: count >= 2
  };
}
function searchSql(search) {
  if (!search) return Prisma.sql`TRUE`;
  const escaped = search.replace(/[\\%_]/g, v => "\\" + v),
    like = "%" + escaped + "%",
    rut = (normalizeChileanRut(search) ?? search).replace(/[^0-9kK]/g, "").toUpperCase();
  const digits = search.replace(/\D/g, "");
  return Prisma.sql`((c.first_names||' '||COALESCE(c.last_names,'')) ILIKE ${like} OR c.email ILIKE ${like} OR c.phone ILIKE ${like} OR ${digits.length >= 4 ? Prisma.sql`regexp_replace(c.phone,'[^0-9]','','g') LIKE ${"%" + digits + "%"}` : Prisma.sql`FALSE`} OR ${rut.length >= 3 ? Prisma.sql`upper(regexp_replace(c.rut,'[^0-9kK]','','g')) LIKE ${"%" + rut + "%"}` : Prisma.sql`FALSE`})`;
}
export async function commercialCustomers(query, scope) {
  const cutoff = new Date(Date.now() - query.days * 86400000);
  const segment = query.segment === "NEW" ? Prisma.sql`c.created_at>=${cutoff}` : query.segment === "PREVIOUS" ? Prisma.sql`COALESCE(a.purchase_count,0)>=1` : query.segment === "REPEAT" ? Prisma.sql`COALESCE(a.purchase_count,0)>=2` : query.segment === "INACTIVE" ? Prisma.sql`a.last_purchase_at<${cutoff}` : query.segment === "QUOTED" ? Prisma.sql`a.quotation_count>0` : Prisma.sql`TRUE`;
  const cte = Prisma.sql`WITH candidates AS (SELECT c.* FROM customers c WHERE ${searchSql(query.search)}), a AS (SELECT f.customer_id,${stats} FROM commercial_purchase_facts f JOIN candidates c ON c.id=f.customer_id WHERE ${commercialScope(scope)} GROUP BY f.customer_id)`;
  const [rows, counts] = await prisma.$transaction([prisma.$queryRaw`${cte} SELECT c.*,a.purchase_count,a.total_spent,a.first_purchase_at,a.last_purchase_at,a.quotation_count,a.pending_count,a.refund_review_count FROM candidates c LEFT JOIN a ON a.customer_id=c.id WHERE ${segment} ORDER BY c.last_names NULLS LAST,c.first_names,c.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`, prisma.$queryRaw`${cte} SELECT count(*)::int AS total FROM candidates c LEFT JOIN a ON a.customer_id=c.id WHERE ${segment}`]);
  return {
    items: rows.map(r => ({
      id: r.id,
      firstNames: r.first_names,
      lastNames: r.last_names,
      rut: r.rut,
      phone: r.phone,
      email: r.email,
      address: r.address,
      patientId: r.patient_id,
      createdAt: r.created_at,
      version: r.record_version,
      summary: mapCommercialStats(r)
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: counts[0].total,
    totalPages: Math.ceil(counts[0].total / query.pageSize),
    scope: scope.allowedBranchIds ? "AUTHORIZED_BRANCHES" : "ALL_BRANCHES",
    segment: query.segment,
    days: query.days
  };
}
export async function customerCommercialSummary(id, scope) {
  const [row] = await prisma.$queryRaw`SELECT ${stats} FROM commercial_purchase_facts f WHERE f.customer_id=${id}::uuid AND ${commercialScope(scope)}`;
  const branches = await prisma.$queryRaw`SELECT b.id,b.name,count(*)::int AS purchases FROM commercial_purchase_facts f JOIN branches b ON b.id=f.branch_id WHERE f.customer_id=${id}::uuid AND f.is_valid_purchase AND ${commercialScope(scope)} GROUP BY b.id,b.name ORDER BY b.name`;
  return {
    ...mapCommercialStats(row),
    branches,
    scope: scope.allowedBranchIds ? "AUTHORIZED_BRANCHES" : "ALL_BRANCHES"
  };
}
export async function customerCommercialHistory(id, query, scope) {
  const where = {
    customer_id: id,
    ...(scope.allowedBranchIds ? {
      OR: [{
        branch_id: {
          in: scope.allowedBranchIds
        }
      }, {
        branch_id: null,
        created_by: scope.legacyActorId
      }]
    } : {}),
    ...(query.status ? {
      status: query.status
    } : {}),
    ...(query.origin ? {
      origin: query.origin
    } : {})
  };
  const [rows, total] = await prisma.$transaction([prisma.sales.findMany({
    where,
    orderBy: [{
      created_at: "desc"
    }, {
      id: "desc"
    }],
    take: query.pageSize,
    skip: (query.page - 1) * query.pageSize,
    select: {
      id: true,
      sale_number: true,
      created_at: true,
      status: true,
      origin: true,
      fulfillment_method: true,
      total_cents: true,
      quotation_valid_until: true,
      branch_id: true,
      branches: {
        select: {
          name: true
        }
      },
      sale_items: {
        orderBy: {
          position: "asc"
        },
        select: {
          product_name: true,
          product_sku: true,
          quantity: true,
          unit_price_cents: true
        }
      },
      sale_payments: {
        select: {
          amount_cents: true,
          payment_method: true
        }
      },
      external_prescription_id: true,
      prescription_id: true
    }
  }), prisma.sales.count({
    where
  })]);
  return {
    items: rows.map(r => ({
      id: r.id,
      saleNumber: String(r.sale_number),
      createdAt: r.created_at,
      status: r.status,
      origin: r.origin,
      fulfillmentMethod: r.fulfillment_method,
      totalCents: commercialNumber(r.total_cents),
      quotationValidUntil: r.quotation_valid_until,
      branchId: r.branch_id,
      branchName: r.branches?.name ?? null,
      items: r.sale_items.map(i => ({
        name: i.product_name,
        sku: i.product_sku,
        quantity: i.quantity,
        unitPriceCents: commercialNumber(i.unit_price_cents)
      })),
      payments: r.sale_payments.map(p => ({
        method: p.payment_method,
        amountCents: commercialNumber(p.amount_cents)
      })),
      externalPrescriptionId: r.external_prescription_id,
      prescriptionId: r.prescription_id
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize)
  };
}
export async function commercialReport(query, scope) {
  const [row] = await prisma.$queryRaw`WITH visible AS (SELECT f.* FROM commercial_purchase_facts f WHERE ${commercialScope(scope)}), bought AS (SELECT customer_id,count(*)::int AS purchases FROM visible WHERE is_valid_purchase AND purchase_at>=${query.fromDate} AND purchase_at<${query.toDate} AND customer_id IS NOT NULL GROUP BY customer_id) SELECT
 (SELECT count(*)::int FROM customers) AS registered,
 (SELECT count(*)::int FROM customers WHERE created_at>=${query.fromDate} AND created_at<${query.toDate}) AS newly_registered,
 (SELECT count(*)::int FROM bought) AS buyers,
 (SELECT count(*)::int FROM bought WHERE purchases>=2) AS recurring,
 count(*) FILTER(WHERE is_valid_purchase AND customer_id IS NULL)::int AS anonymous_purchases,
 count(*) FILTER(WHERE is_valid_purchase AND customer_id IS NOT NULL)::int AS identified_purchases,
 COALESCE(sum(total_cents) FILTER(WHERE is_valid_purchase),0)::text AS total_spent FROM visible WHERE purchase_at>=${query.fromDate} AND purchase_at<${query.toDate}`;
  return {
    registeredCustomers: row.registered,
    newCustomers: row.newly_registered,
    purchasingCustomers: row.buyers,
    recurringCustomers: row.recurring,
    anonymousPurchases: row.anonymous_purchases,
    identifiedPurchases: row.identified_purchases,
    totalSpentCents: commercialNumber(row.total_spent),
    filters: {
      from: query.from,
      to: query.to,
      timeZone: "America/Santiago"
    },
    scope: scope.allowedBranchIds ? "AUTHORIZED_BRANCHES" : "ALL_BRANCHES"
  };
}
