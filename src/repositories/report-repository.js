import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
const n = value => Number(value ?? 0);
export async function getSalesReportData({ fromDate, origin, status, toDate, allowedBranchIds, legacyActorId }, client = prisma) {
  const scope = allowedBranchIds ? Prisma.sql`AND (s.branch_id IN (${allowedBranchIds.length ? Prisma.join(allowedBranchIds.map(id=>Prisma.sql`${id}::uuid`)) : Prisma.sql`NULL::uuid`}) OR (s.branch_id IS NULL AND s.created_by=${legacyActorId ?? null}::uuid))` : Prisma.empty;
  const base = Prisma.sql`WITH matched AS (SELECT s.id,s.status,s.created_at,s.total_cents,s.discount_cents,s.shipping_fee_cents FROM sales s WHERE s.created_at>=${fromDate} AND s.created_at<${toDate} ${scope} ${origin ? Prisma.sql`AND s.origin=${origin}` : Prisma.empty} ${status ? Prisma.sql`AND s.status=${status}` : Prisma.empty}), included AS (SELECT * FROM matched WHERE status NOT IN ('QUOTATION','CANCELLED'))`;
  const [summaryRows,statuses,daily,methods,products] = await client.$transaction([
    client.$queryRaw`${base} SELECT (SELECT count(*) FROM matched)::int AS operations,(SELECT count(*) FROM matched WHERE status='CANCELLED')::int AS cancelled,COALESCE(sum(total_cents),0) AS total,COALESCE(sum(discount_cents),0) AS discount,COALESCE(sum(shipping_fee_cents),0) AS shipping,(SELECT COALESCE(sum(p.amount_cents),0) FROM sale_payments p JOIN included i ON i.id=p.sale_id) AS paid FROM included`,
    client.$queryRaw`${base} SELECT status,count(*)::int AS count,COALESCE(sum(total_cents),0) AS total FROM matched GROUP BY status ORDER BY status`,
    client.$queryRaw`${base} SELECT (created_at AT TIME ZONE 'America/Santiago')::date::text AS day,count(*)::int AS count,COALESCE(sum(total_cents),0) AS total FROM included GROUP BY day ORDER BY day`,
    client.$queryRaw`${base} SELECT p.payment_method AS method,count(*)::int AS count,sum(p.amount_cents) AS paid FROM sale_payments p JOIN included i ON i.id=p.sale_id GROUP BY p.payment_method ORDER BY paid DESC`,
    client.$queryRaw`${base} SELECT p.product_id AS id,max(p.product_name) AS name,max(p.product_sku) AS sku,sum(p.quantity) AS units,sum(p.quantity*p.unit_price_cents) AS gross FROM sale_items p JOIN included i ON i.id=p.sale_id GROUP BY p.product_id ORDER BY units DESC,gross DESC LIMIT 20`,
  ],{isolationLevel:"RepeatableRead"});
  const s=summaryRows[0];
  return {
    summary:{operationCount:n(s.operations),cancelledCount:n(s.cancelled),totalCents:n(s.total),discountCents:n(s.discount),shippingCents:n(s.shipping),paidCents:n(s.paid),balanceCents:Math.max(0,n(s.total)-n(s.paid))},
    statuses:statuses.map(r=>({status:r.status,count:n(r.count),totalCents:n(r.total)})),
    daily:daily.map(r=>({day:r.day,count:n(r.count),totalCents:n(r.total)})),
    paymentMethods:methods.map(r=>({paymentMethod:r.method,paymentCount:n(r.count),paidCents:n(r.paid)})),
    products:products.map(r=>({productId:r.id,productName:r.name,productSku:r.sku,units:n(r.units),grossCents:n(r.gross)})),
  };
}
