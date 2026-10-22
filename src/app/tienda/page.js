import Link from "next/link";
import { Suspense } from "react";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import CatalogBrowser from "./catalog-browser";
import styles from "./store.module.css";

export const metadata = { description: "Explora los productos publicados por Óptica Stylo.", title: "Tienda" };

export default function StorePage() {
  return <><PublicHeader /><main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Migas de pan"><Link href="/">Inicio</Link><span>/</span><span>Catálogo</span></nav>
    <header className={styles.heading}><div><h1>Encuentra los lentes para tu estilo</h1><p>Explora marcos, tratamientos y accesorios seleccionados por Óptica Stylo. Los cristales se configuran dentro de cada marco.</p></div></header>
    <Suspense fallback={<p role="status">Cargando catálogo…</p>}><CatalogBrowser /></Suspense>
  </main><PublicFooter /></>;
}
