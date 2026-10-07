import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { RB2140_3D_GLASSES } from "@/constants/virtual-try-on";
import PerformanceValidation from "./performance-validation";

export const dynamic = "force-dynamic";
export default async function PerformancePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const metadata = JSON.parse(await readFile(path.join(process.cwd(), `public${RB2140_3D_GLASSES.metadataUrl}`), "utf8"));
  return <PerformanceValidation metadata={metadata} modelUrl={RB2140_3D_GLASSES.modelUrl}
    lensOpacity={RB2140_3D_GLASSES.lensOpacity} lensTintStrength={RB2140_3D_GLASSES.lensTintStrength} />;
}
