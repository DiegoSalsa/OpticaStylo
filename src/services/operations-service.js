import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/app-error.js";
import { expireInventoryReservations } from "../repositories/inventory-repository.js";
import { processTransactionalEmailBatch } from "./transactional-email-service.js";
import { shippingConfiguration } from "../config/shipping.js";
import { syncShipment } from "./shipping-service.js";

// Each invocation is bounded for a serverless function. No background promise,
// no setInterval, no transport creation or financial charges in maintenance.
export async function runOperationsJob(job) {
  if (process.env.OPERATIONS_ENABLED !== "true") return { status: "DISABLED", job };
  if (job === "reservations") return { status: "SUCCESS", job, processed: await expireInventoryReservations({limit:5,deadline:Date.now()+15000}) };
  if (job === "emails") {
    const result = await processTransactionalEmailBatch({triggerSource:"cron",limit:1});
    return { status: result.status, job, claimed: result.claimed, sent: result.sent, failed: result.failed };
  }
  if (job === "shipping") {
    const config = shippingConfiguration();
    if (config.mode === "disabled") return {status:"DISABLED",job};
    const row = await prisma.shipping_shipments.findFirst({where:{state:{in:["OT_ISSUED","HANDED_OVER","IN_TRANSIT","EXCEPTION"]},quote:{environment:config.mode},OR:[{next_sync_at:null},{next_sync_at:{lte:new Date()}}]},orderBy:[{next_sync_at:{sort:"asc",nulls:"first"}},{created_at:"asc"}]});
    if (row) await syncShipment(row.sale_id);
    return {status:"SUCCESS",job,processed:row?1:0};
  }
  throw new AppError({code:"INVALID_OPERATIONS_JOB",message:"Trabajo operativo inválido.",status:400});
}
