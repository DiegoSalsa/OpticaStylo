import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import CatalogBrowser from "./catalog-browser";
import styles from "./store.module.css";

export const metadata = { description: "Explora los productos publicados por Óptica Stylo.", title: "Tienda" };

export default function StorePage() {
  return <><PublicHeader /><main className={styles.page}><header className={styles.heading}><p className="eyebrow">Tienda Óptica Stylo</p><h1>Encuentra los lentes para tu estilo</h1><p>Explora el catálogo real publicado por la óptica. La disponibilidad es informativa mientras se conecta el inventario definitivo.</p></header><CatalogBrowser /></main><PublicFooter /></>;
}
