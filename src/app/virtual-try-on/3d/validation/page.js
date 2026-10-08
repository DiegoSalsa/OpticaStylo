import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import ValidationViewer from "./validation-viewer";
import { BUILT_IN_3D_GLASSES } from "@/constants/virtual-try-on";

export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const root = process.cwd();
  const face = JSON.parse(await readFile(path.join(root, "tests/fixtures/canonical-face.json"), "utf8"));
  const models = await Promise.all(BUILT_IN_3D_GLASSES.map(async (model) => ({
    url: model.modelUrl, lensOpacity: model.lensOpacity ?? null, lensTintStrength: model.lensTintStrength ?? 1,
    metadata: JSON.parse(await readFile(path.join(root, `public${model.metadataUrl}`), "utf8")),
  })));
  return <ValidationViewer face={face} models={models} />;
}
