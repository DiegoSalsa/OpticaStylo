import { executeQuery } from "../db/query.js";

const n = (value) => Number(value ?? 0);
export async function getSalesReportData({ fromDate, origin, status, toDate }) {
  const filter = `sales.created_at >= $1 AND sales.created_at < $2
    AND ($3::varchar IS NULL OR sales.status = $3)
    AND ($4::varchar IS NULL OR sales.origin = $4)`;
  const params = [fromDate, toDate, status, origin];
  const [summary, statuses, methods, daily, products] = await Promise.all([
    executeQuery(
      `SELECT COUNT(*) AS operation_count,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_count,
      COALESCE(SUM(total_cents) FILTER (
        WHERE status NOT IN ('QUOTATION', 'CANCELLED')
      ), 0) AS total_cents,
      COALESCE(SUM(discount_cents) FILTER (
        WHERE status NOT IN ('QUOTATION', 'CANCELLED')
      ), 0) AS discount_cents,
      COALESCE(SUM(shipping_fee_cents) FILTER (
        WHERE status NOT IN ('QUOTATION', 'CANCELLED')
      ), 0) AS shipping_cents,
      COALESCE((SELECT SUM(sale_payments.amount_cents) FROM sale_payments
        JOIN sales paid_sales ON paid_sales.id = sale_payments.sale_id
        WHERE paid_sales.created_at >= $1 AND paid_sales.created_at < $2
          AND ($3::varchar IS NULL OR paid_sales.status = $3)
          AND ($4::varchar IS NULL OR paid_sales.origin = $4)
          AND paid_sales.status NOT IN ('QUOTATION', 'CANCELLED')), 0) AS paid_cents
      FROM sales WHERE ${filter}`,
      params,
    ),
    executeQuery(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
      FROM sales WHERE ${filter} GROUP BY status ORDER BY status`,
      params,
    ),
    executeQuery(
      `SELECT sale_payments.payment_method, COUNT(*) AS payment_count,
      SUM(sale_payments.amount_cents) AS paid_cents
      FROM sale_payments JOIN sales ON sales.id = sale_payments.sale_id
      WHERE ${filter} AND sales.status <> 'CANCELLED'
      GROUP BY sale_payments.payment_method ORDER BY paid_cents DESC`,
      params,
    ),
    executeQuery(
      `SELECT (sales.created_at AT TIME ZONE 'America/Santiago')::date AS day,
      COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total_cents
      FROM sales WHERE ${filter} AND status NOT IN ('QUOTATION', 'CANCELLED')
      GROUP BY day ORDER BY day`,
      params,
    ),
    executeQuery(
      `SELECT sale_items.product_id, sale_items.product_sku, sale_items.product_name,
      SUM(sale_items.quantity) AS units, SUM(sale_items.quantity * sale_items.unit_price_cents) AS gross_cents
      FROM sale_items JOIN sales ON sales.id = sale_items.sale_id
      WHERE ${filter} AND sales.status NOT IN ('QUOTATION', 'CANCELLED')
      GROUP BY sale_items.product_id, sale_items.product_sku, sale_items.product_name
      ORDER BY units DESC, gross_cents DESC LIMIT 20`,
      params,
    ),
  ]);
  const row = summary.rows[0];
  return {
    daily: daily.rows.map((item) => ({
      count: n(item.count),
      day: item.day,
      totalCents: n(item.total_cents),
    })),
    paymentMethods: methods.rows.map((item) => ({
      paidCents: n(item.paid_cents),
      paymentCount: n(item.payment_count),
      paymentMethod: item.payment_method,
    })),
    products: products.rows.map((item) => ({
      grossCents: n(item.gross_cents),
      productId: item.product_id,
      productName: item.product_name,
      productSku: item.product_sku,
      units: n(item.units),
    })),
    statuses: statuses.rows.map((item) => ({
      count: n(item.count),
      status: item.status,
      totalCents: n(item.total_cents),
    })),
    summary: {
      balanceCents: Math.max(0, n(row.total_cents) - n(row.paid_cents)),
      cancelledCount: n(row.cancelled_count),
      discountCents: n(row.discount_cents),
      operationCount: n(row.operation_count),
      paidCents: n(row.paid_cents),
      shippingCents: n(row.shipping_cents),
      totalCents: n(row.total_cents),
    },
  };
}
