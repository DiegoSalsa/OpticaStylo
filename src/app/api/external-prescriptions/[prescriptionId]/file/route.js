import { authenticateRequest } from "@/auth/authenticate-request";
import { getExternalPrescriptionFile } from "@/services/external-prescription-service";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const actor = await authenticateRequest(request);
    const { prescriptionId } = await params;
    const file = await getExternalPrescriptionFile(prescriptionId, actor);
    return new Response(file.data, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Content-Type": file.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
