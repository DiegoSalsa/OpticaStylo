import { toZonedTime } from "date-fns-tz";

import { prisma } from "../db/prisma.js";

const n = (value) => Number(value ?? 0);

export async function getSalesReportData({ fromDate, origin, status, toDate }) {
  const sales = await prisma.sales.findMany({
    include: { sale_items: true, sale_payments: true },
    where: {
      created_at: { gte: fromDate, lt: toDate },
      ...(origin ? { origin } : {}),
      ...(status ? { status } : {}),
    },
  });
  const included = sales.filter((sale) => !["QUOTATION", "CANCELLED"].includes(sale.status));
  const statuses = new Map();
  const methods = new Map();
  const daily = new Map();
  const products = new Map();
  for (const sale of sales) {
    const statusItem = statuses.get(sale.status) ?? { count: 0, status: sale.status, totalCents: 0 };
    statusItem.count += 1;
    statusItem.totalCents += n(sale.total_cents);
    statuses.set(sale.status, statusItem);
  }
  for (const sale of included) {
    const day = toZonedTime(sale.created_at, "America/Santiago").toISOString().slice(0, 10);
    const dailyItem = daily.get(day) ?? { count: 0, day, totalCents: 0 };
    dailyItem.count += 1;
    dailyItem.totalCents += n(sale.total_cents);
    daily.set(day, dailyItem);
    for (const payment of sale.sale_payments) {
      const item = methods.get(payment.payment_method) ?? {
        paidCents: 0, paymentCount: 0, paymentMethod: payment.payment_method,
      };
      item.paidCents += n(payment.amount_cents);
      item.paymentCount += 1;
      methods.set(payment.payment_method, item);
    }
    for (const saleItem of sale.sale_items) {
      const item = products.get(saleItem.product_id) ?? {
        grossCents: 0, productId: saleItem.product_id,
        productName: saleItem.product_name, productSku: saleItem.product_sku, units: 0,
      };
      item.units += saleItem.quantity;
      item.grossCents += saleItem.quantity * n(saleItem.unit_price_cents);
      products.set(saleItem.product_id, item);
    }
  }
  const totalCents = included.reduce((sum, sale) => sum + n(sale.total_cents), 0);
  const paidCents = included.flatMap((sale) => sale.sale_payments)
    .reduce((sum, payment) => sum + n(payment.amount_cents), 0);
  return {
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    paymentMethods: [...methods.values()].sort((a, b) => b.paidCents - a.paidCents),
    products: [...products.values()].sort((a, b) => b.units - a.units || b.grossCents - a.grossCents).slice(0, 20),
    statuses: [...statuses.values()].sort((a, b) => a.status.localeCompare(b.status)),
    summary: {
      balanceCents: Math.max(0, totalCents - paidCents),
      cancelledCount: sales.filter((sale) => sale.status === "CANCELLED").length,
      discountCents: included.reduce((sum, sale) => sum + n(sale.discount_cents), 0),
      operationCount: sales.length,
      paidCents,
      shippingCents: included.reduce((sum, sale) => sum + n(sale.shipping_fee_cents), 0),
      totalCents,
    },
  };
}
