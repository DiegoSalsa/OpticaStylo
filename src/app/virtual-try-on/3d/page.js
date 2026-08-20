import Glasses3DOverlay from "./glasses-3d-overlay";
import styles from "./virtual-try-on-3d.module.css";

export const metadata = {
  description: "Pruébate un marco óptico 3D en tiempo real y de forma privada.",
  title: "Probador virtual 3D",
};

export default function VirtualTryOn3DPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <a className={styles.brand} href="/virtual-try-on" aria-label="Volver al probador de Óptica Stylo">
          <span className={styles.brandMark} aria-hidden="true">OS</span>
          <span>Óptica Stylo</span>
        </a>
        <div className={styles.heroCopy}>
          <div>
            <p className={styles.eyebrow}>Probador virtual · 3D</p>
            <h1>Mírate con tus próximos lentes.</h1>
          </div>
          <p>
            Mira de frente y deja que el marco se ajuste a tu rostro. Puedes
            girar suavemente para verlo desde distintos ángulos.
          </p>
        </div>
      </header>
      <Glasses3DOverlay />
    </main>
  );
}
