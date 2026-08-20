import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

import Glasses3DOverlay from "./glasses-3d-overlay";
import styles from "./virtual-try-on-3d.module.css";

export const metadata = {
  description: "Pruébate un marco óptico 3D en tiempo real y de forma privada.",
  title: "Probador virtual 3D | Óptica Stylo",
};

export default function VirtualTryOn3DPage() {
  return <>
    <PublicHeader />
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div><p className={styles.eyebrow}>Probador virtual · 3D</p><h1>Encuentra el marco que va contigo.</h1></div>
          <p>Prueba los modelos 3D vinculados al catálogo real. Mira de frente y gira suavemente para comprobar el ajuste visual.</p>
        </div>
      </header>
      <Glasses3DOverlay />
    </main>
    <PublicFooter />
  </>;
}
