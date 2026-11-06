import { authenticateRequest } from "@/auth/authenticate-request";
import { shipmentLabel } from "@/services/shipping-service";
import { executeApiHandler } from "@/utils/error-handler";
export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const label = await shipmentLabel((await params).saleId, await authenticateRequest(request));
    return new Response(new Uint8Array(label.data), { headers: {
      "Content-Type": label.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
      "Content-Disposition": "inline", "Referrer-Policy": "no-referrer",
    } });
  }, { sensitive: true });
}
