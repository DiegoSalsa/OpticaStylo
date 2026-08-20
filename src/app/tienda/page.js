import Link from "next/link";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import Icon from "@/components/ui/icon";
import CatalogBrowser from "./catalog-browser";
import styles from "./store.module.css";

export const metadata = { description: "Explora los productos publicados por Óptica Stylo.", title: "Tienda" };

export default async function StorePage({ searchParams }) {
  const { category = "" } = await searchParams;
  return <><PublicHeader /><main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Migas de pan"><Link href="/">Inicio</Link><span>/</span><span>Catálogo</span></nav>
    <header className={styles.heading}><div><p className="eyebrow">Tienda Óptica Stylo</p><h1>Encuentra tu próximo marco</h1><p>Explora los productos publicados por la óptica. Los precios son reales; la disponibilidad seguirá siendo informativa hasta conectar el inventario definitivo.</p></div><div className={styles.headingStat}><span><Icon name="eye" /></span><p><strong>Prueba virtual 3D</strong>Disponible únicamente en marcos con un modelo 3D vinculado.</p></div></header>
    <CatalogBrowser initialCategory={typeof category === "string" ? category : ""} />
  </main><PublicFooter /></>;
}
