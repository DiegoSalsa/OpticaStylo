import { authenticateRequest } from "@/auth/authenticate-request";
import { retryFailedTransactionalEmail } from "@/services/transactional-email-service";
import { createSuccessResponse } from "@/utils/api-response";
import { executeApiHandler } from "@/utils/error-handler";

// POST /api/admin/transactional-emails/[emailId]/retry/ - crear el recurso aplicando autenticación, validaciones y reglas de negocio
export async function POST(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { emailId } = await params;
    return createSuccessResponse(
      await retryFailedTransactionalEmail(emailId, actor),
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

