import { createSuccessResponse } from "@/utils/api-response";

export async function GET() {
  return createSuccessResponse({
    service: "optica-stylo",
    status: "ok",
  });
}
