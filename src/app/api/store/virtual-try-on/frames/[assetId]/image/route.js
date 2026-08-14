import { getPublicVirtualTryOnAssetFile } from "@/services/virtual-try-on-service";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(request, { params }) {
  return executeApiHandler(async () => {
    const { assetId } = await params;
    const file = await getPublicVirtualTryOnAssetFile(assetId);
    const etag = `"${file.sha256}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(file.data, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Content-Type": file.mediaType,
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
