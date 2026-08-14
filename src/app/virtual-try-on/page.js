import VirtualTryOnExperience from "./virtual-try-on-experience";
import styles from "./virtual-try-on.module.css";

export const metadata = {
  description: "Prueba marcos ópticos con la cámara sin enviar imágenes del rostro al servidor.",
  title: "Prueba virtual de marcos",
};

export default function VirtualTryOnPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <a className={styles.brand} href="/virtual-try-on" aria-label="Óptica Stylo, inicio">
          <span className={styles.brandMark} aria-hidden="true">OS</span>
          <span>Óptica Stylo</span>
        </a>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Prueba virtual · versión experimental</p>
          <h1>Encuentra el marco que se siente como tú.</h1>
          <p>
            Autoriza la cámara cuando el navegador la solicite, mira de frente y
            cambia de estilo. El análisis ocurre en este dispositivo y la óptica
            no recibe tu video.
          </p>
        </div>
      </header>
      <VirtualTryOnExperience />
    </main>
  );
}
