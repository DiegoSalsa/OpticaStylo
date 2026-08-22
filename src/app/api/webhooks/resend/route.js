import { processResendWebhook } from "@/services/resend-webhook-service";
import { createErrorResponse } from "@/utils/api-response";

export const maxDuration = 10;

export async function POST(request) {
  const rawBody = await request.text();
  try {
    await processResendWebhook(rawBody, request.headers);
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return createErrorResponse(
      {
        code: error?.code === "INVALID_EMAIL_WEBHOOK_SIGNATURE"
          ? error.code
          : "INVALID_EMAIL_WEBHOOK",
        message: "No fue posible validar el webhook.",
      },
      error?.status === 400 ? 400 : 500,
    );
  }
}

