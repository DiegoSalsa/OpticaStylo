import { PASSWORD_RECOVERY_SCOPES } from "@/auth/password-recovery-token";
import { handlePasswordResetRequest } from "@/app/api/password-recovery-handler";
import {
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";
import { executeApiHandler } from "@/utils/error-handler";

export async function POST(request) {
  return executeApiHandler(async () => {
    return handlePasswordResetRequest(
      request,
      {
        operation: PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RESET,
        scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
      },
    );
  });
}
