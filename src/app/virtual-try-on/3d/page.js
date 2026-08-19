import Glasses3DOverlay from "./glasses-3d-overlay";
import styles from "./virtual-try-on-3d.module.css";

export const metadata = {
  description: "Prueba marcos ópticos en 3D con la cámara sin enviar imágenes del rostro al servidor.",
  title: "Prueba virtual 3D de marcos",
};

export default function VirtualTryOn3DPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <a className={styles.brand} href="/virtual-try-on" aria-label="Óptica Stylo, inicio">
          <span className={styles.brandMark} aria-hidden="true">OS</span>
          <span>Óptica Stylo</span>
        </a>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Prueba virtual 3D · versión experimental</p>
          <h1>Lentes en tres dimensiones, sobre tu rostro.</h1>
          <p>
            Autoriza la cámara y mira de frente. El modelo 3D se alinea
            automáticamente con tus rasgos. Todo el procesamiento ocurre en tu
            dispositivo.
          </p>
        </div>
      </header>
      <Glasses3DOverlay />
    </main>
  );
}
