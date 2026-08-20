import { getPublic3dModelFile } from "@/services/virtual-try-on-3d-catalog-service";
import { executeApiHandler } from "@/utils/error-handler";

export async function GET(_request, { params }) {
  return executeApiHandler(async () => {
    const { assetId } = await params;
    const file = await getPublic3dModelFile(assetId);
    return new Response(file.data, {
      headers: {
        "Cache-Control": "public, max-age=3600, immutable",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Content-Type": "model/gltf-binary",
        "ETag": `"${file.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
