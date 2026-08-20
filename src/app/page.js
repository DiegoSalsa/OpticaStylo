import Link from "next/link";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import Icon from "@/components/ui/icon";
import styles from "./page.module.css";

const paths = [
  { description: "Explora los productos publicados por la óptica con precios y disponibilidad informativa.", eyebrow: "Tienda en línea", href: "/tienda", icon: "sparkle", label: "Explorar la tienda", title: "Encuentra los lentes para tu estilo" },
  { description: "Prueba los marcos habilitados con la cámara. El procesamiento ocurre en tu dispositivo.", eyebrow: "Experiencia 3D", href: "/virtual-try-on/3d", icon: "eye", label: "Abrir probador 3D", title: "Mírate con tus próximos lentes" },
  { description: "Revisa horarios disponibles y reserva en línea sin llamar ni acudir previamente al local.", eyebrow: "Agenda en línea", href: "/reservar", icon: "calendar", label: "Reservar una evaluación", title: "Tu próxima evaluación, a un clic" },
];

export default function HomePage() {
  return (
    <>
      <PublicHeader />
      <main>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <p className="eyebrow">Óptica Stylo · Experiencia digital</p>
            <h1>Mira el mundo con tu <span>mejor estilo.</span></h1>
            <p className={styles.lead}>Compra, reserva tu evaluación y encuentra el marco que te representa desde una experiencia simple, cercana y segura.</p>
            <div className={styles.heroActions}>
              <Link className="button button--primary" href="/tienda">Ver tienda <Icon name="arrow" /></Link>
              <Link className="button button--secondary" href="/reservar"><Icon name="calendar" /> Reservar evaluación</Link>
            </div>
            <ul className={styles.trustList}>
              <li><Icon name="check" /> Compra con cuenta o como invitado</li>
              <li><Icon name="check" /> Recetas internas o externas</li>
              <li><Icon name="check" /> Retiro en tienda</li>
            </ul>
          </div>
          <div className={styles.heroVisual} aria-label="Vista previa de la experiencia Óptica Stylo">
            <div className={styles.visualBackdrop} />
            <div className={styles.glassesIllustration} aria-hidden="true"><span /><i /><span /></div>
            <div className={styles.visualCard}>
              <span className={styles.visualIcon}><Icon name="eye" /></span>
              <div><strong>Probador virtual 3D</strong><p>Disponible para marcos compatibles</p></div>
              <Icon name="chevron" />
            </div>
            <div className={styles.visualBadge}><span /> Tecnología de seguimiento facial</div>
          </div>
        </section>

        <section className={styles.paths} aria-labelledby="experience-title">
          <div className="section-heading">
            <p className="eyebrow">Todo en un mismo lugar</p>
            <h2 id="experience-title">Una experiencia pensada para acompañarte</h2>
            <p>Elige cómo quieres comenzar y avanza a tu ritmo.</p>
          </div>
          <div className={styles.pathGrid}>
            {paths.map((path, index) => (
              <article className={styles.pathCard} key={path.href}>
                <div className={styles.pathNumber}>0{index + 1}</div>
                <span className={styles.pathIcon}><Icon name={path.icon} size={25} /></span>
                <p className="eyebrow">{path.eyebrow}</p>
                <h3>{path.title}</h3>
                <p>{path.description}</p>
                <Link href={path.href}>{path.label} <Icon name="arrow" /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.closing}>
          <div><p className="eyebrow eyebrow--light">Atención visual</p><h2>¿Necesitas orientación antes de elegir?</h2><p>Reserva una evaluación y revisa tus alternativas con el equipo de la óptica.</p></div>
          <Link className="button button--light" href="/reservar">Ver horas disponibles <Icon name="arrow" /></Link>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
