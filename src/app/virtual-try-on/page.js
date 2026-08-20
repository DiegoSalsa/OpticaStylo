import { redirect } from "next/navigation";

export const metadata = {
  description: "Probador virtual 3D de Óptica Stylo.",
  title: "Probador virtual 3D",
};

export default function VirtualTryOnPage() {
  redirect("/virtual-try-on/3d");
}
