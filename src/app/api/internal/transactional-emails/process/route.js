import { processTransactionalEmailBatch } from "@/services/transactional-email-service";
import { hasValidBearerSecret } from "@/utils/secret-authorization";

export const maxDuration = 30;

function noStoreJson(data, status = 200) {
  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

async function process(request) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return noStoreJson({ success: false }, 401);
  }
  try {
    const summary = await processTransactionalEmailBatch({ triggerSource: "cron" });
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

export async function GET(request) {
  return process(request);
}

export async function POST(request) {
  return process(request);
}

