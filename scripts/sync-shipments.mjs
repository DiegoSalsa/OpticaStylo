import { loadProjectEnvironment } from "./load-environment.mjs";
import { prisma } from "../src/db/prisma.js";
import { syncShipment } from "../src/services/shipping-service.js";
import { shippingConfiguration } from "../src/config/shipping.js";
// Schedule through the existing deployment scheduler. No public cron endpoint.
loadProjectEnvironment();
try {
  const config = shippingConfiguration();
  if (config.mode === "disabled") throw new Error("Chilexpress no configurado.");
  const rows = await prisma.shipping_shipments.findMany({ where: { state: { in: ["OT_ISSUED", "HANDED_OVER", "IN_TRANSIT", "EXCEPTION"] }, quote: { environment: config.mode }, OR: [{ next_sync_at: null }, { next_sync_at: { lte: new Date() } }] }, take: 50 });
  let updated = 0, failed = 0;
  for (const row of rows) {
    try { await syncShipment(row.sale_id); updated++; } catch { failed++; }
  }
  console.log(JSON.stringify({ checked: rows.length, updated, failed }));
} finally { await prisma.$disconnect(); }
