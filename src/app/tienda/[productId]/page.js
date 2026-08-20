import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

import ProductDetail from "./product-detail";
import "./product-detail.css";

export const metadata = { title: "Producto | Óptica Stylo" };

export default async function ProductPage({ params }) {
  const { productId } = await params;
  return <><PublicHeader /><ProductDetail productId={productId} /><PublicFooter /></>;
}
