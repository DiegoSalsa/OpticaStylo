import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import PerformanceValidation from "./performance-validation";

export const dynamic = "force-dynamic";
export default async function PerformancePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const metadata = JSON.parse(await readFile(path.join(process.cwd(),
    "public/virtual-try-on/models/Harley-Davidson_HD0896_001_V4_definitivo.tryon.json"), "utf8"));
  return <PerformanceValidation metadata={metadata} />;
}
