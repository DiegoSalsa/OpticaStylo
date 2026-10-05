import { redirect } from "next/navigation";

export const metadata = {
  description: "Punto de venta presencial de Óptica Stylo.",
  title: "Punto de venta",
};

export default function PosPage() {
  redirect("/app/ventas");
}
