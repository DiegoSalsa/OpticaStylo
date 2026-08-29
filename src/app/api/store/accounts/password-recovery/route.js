import { PASSWORD_RECOVERY_SCOPES } from "@/auth/password-recovery-token";
import { handlePasswordRecoveryRequest } from "@/app/api/password-recovery-handler";
import {
  PUBLIC_REQUEST_LIMIT_OPERATIONS,
} from "@/security/public-request-rate-limit";
import { executeApiHandler } from "@/utils/error-handler";

export async function POST(request) {
  return executeApiHandler(async () => {
    return handlePasswordRecoveryRequest(
      request,
      {
        operation: PUBLIC_REQUEST_LIMIT_OPERATIONS.STORE_PASSWORD_RECOVERY_REQUEST,
        scope: PASSWORD_RECOVERY_SCOPES.STORE_ACCOUNT,
      },
    );
  });
}
