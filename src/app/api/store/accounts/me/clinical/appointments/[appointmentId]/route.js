import { authenticateCustomerRequest } from "@/auth/store-session";
import { manageCustomerAppointment } from "@/services/customer-appointment-service";
import { executeClinicalHandler } from "@/utils/error-handler";
import { readJsonBody } from "@/utils/http-request";
import { createPrivateStoreResponse } from "@/utils/store-response";

export async function PATCH(request, { params }) {
  return executeClinicalHandler(async () => {
    const account = await authenticateCustomerRequest(request);
    const { appointmentId } = await params;
    const result = await manageCustomerAppointment(account, appointmentId, await readJsonBody(request));
    return createPrivateStoreResponse(result);
  });
}
