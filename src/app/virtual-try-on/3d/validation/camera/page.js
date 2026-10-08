import { notFound } from "next/navigation";
import CameraValidation from "./camera-validation";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CameraValidation />;
}
