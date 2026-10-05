import Link from "next/link";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import CatalogBrowser from "./catalog-browser";
import styles from "./store.module.css";

export const metadata = { description: "Explora los productos publicados por Óptica Stylo.", title: "Tienda" };

export default async function StorePage({ searchParams }) {
  const { category = "" } = await searchParams;
  return <><PublicHeader /><main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Migas de pan"><Link href="/">Inicio</Link><span>/</span><span>Catálogo</span></nav>
    <header className={styles.heading}><div><h1>Encuentra los lentes para tu estilo</h1><p>Explora marcos, tratamientos y accesorios seleccionados por Óptica Stylo. Los cristales se configuran dentro de cada marco.</p></div></header>
    <CatalogBrowser initialCategory={typeof category === "string" ? category : ""} />
  </main><PublicFooter /></>;
}
