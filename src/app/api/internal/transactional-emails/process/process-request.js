import { processTransactionalEmailBatch } from "../../../../../services/transactional-email-service.js";
import { hasValidBearerSecret } from "../../../../../utils/secret-authorization.js";

function noStoreJson(data, status = 200) {
  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export async function processRequest(request, dependencies = {}) {
  const processBatch = dependencies.processBatch ?? processTransactionalEmailBatch;
  const secret = dependencies.secret ?? process.env.CRON_SECRET;

  if (!hasValidBearerSecret(request, secret)) {
    return noStoreJson({ success: false }, 401);
  }
  try {
    const summary = await processBatch({ triggerSource: "cron" });
    return noStoreJson({
      success: true,
      summary: {
        claimed: summary.claimed,
        deadLetter: summary.deadLetter,
        failed: summary.failed,
        mode: summary.mode,
        recovered: summary.recovered,
        sent: summary.sent,
        simulated: summary.simulated,
        status: summary.status,
      },
    });
  } catch {
    return noStoreJson({ success: false }, 500);
  }
}
