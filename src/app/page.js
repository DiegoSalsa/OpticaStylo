import Link from "next/link";
import Image from "next/image";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import FeaturedProducts from "@/components/store/featured-products";
import Icon from "@/components/ui/icon";
import styles from "./page.module.css";

const stitchImages = {
  hero: "/images/stitch-home/hero-stylo-vivo.webp",
  frames: "/images/stitch-home/category-frames.webp",
  lenses: "/images/stitch-home/category-lenses.webp",
  tryOn: "/images/stitch-home/virtual-try-on.webp",
};

const experienceCards = [
  { icon: "calendar", title: "Reserva en línea", text: "Elige una hora disponible y recibe la confirmación de tu reserva." },
  { icon: "file", title: "Recetas externas", text: "Puedes comprar con una receta emitida aquí o en cualquier otro centro." },
  { icon: "cart", title: "Compra flexible", text: "Compra con cuenta o como invitado y conserva tu carrito durante el proceso." },
];

export default function HomePage() {
  return <>
    <PublicHeader />
    <main className={styles.home}>
      <section className={styles.hero}>
        <Image alt="Persona usando anteojos en una óptica" className={styles.heroImage} fill preload sizes="100vw" src={stitchImages.hero} />
        <div className={styles.heroShade} />
        <div className={styles.heroCopy}>
          <span className={styles.chip}>Stylo Vivo · Nueva experiencia</span>
          <h1>Mira el mundo<br />con tu mejor<br /><em>estilo.</em></h1>
          <p>Encuentra el marco perfecto que hable de ti. Tecnología, diseño y salud visual en un solo lugar.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/tienda">Ver marcos <Icon name="arrow" size={17} /></Link>
            <Link className={styles.secondaryButton} href="/virtual-try-on/3d"><Icon name="eye" size={18} /> Probarme lentes</Link>
          </div>
        </div>
      </section>

      <section className={styles.categories} aria-labelledby="categories-title">
        <div className={styles.sectionLead}>
          <div><h2 id="categories-title">Explora nuestras categorías</h2><p>Todo lo que necesitas para tu visión, con el mejor diseño.</p></div>
          <Link href="/tienda">Ver todo el catálogo <Icon name="arrow" size={15} /></Link>
        </div>
        <div className={styles.bento}>
          <Link className={`${styles.bentoCard} ${styles.frames}`} href="/tienda?category=FRAME">
            <Image alt="Selección de marcos ópticos" fill sizes="(max-width: 960px) 100vw, 50vw" src={stitchImages.frames} />
            <div className={styles.photoShade} />
            <div className={styles.cardCopy}><span>Popular</span><h3>Marcos de Receta</h3><p>Explorar colección <Icon name="arrow" size={15} /></p></div>
          </Link>
          <Link className={`${styles.bentoCard} ${styles.lenses}`} href="/tienda?category=PRESCRIPTION_LENS">
            <Image alt="Cristales ópticos" fill sizes="(max-width: 960px) 100vw, 50vw" src={stitchImages.lenses} />
            <div className={styles.lensShade} />
            <div className={styles.cardCopy}><h3>Cristales</h3><p>Tecnología antirreflejo, filtro azul y alternativas de precisión.</p><strong>Ver opciones <Icon name="chevron" size={13} /></strong></div>
          </Link>
          <Link className={`${styles.bentoCard} ${styles.treatments}`} href="/tienda?category=TREATMENT">
            <div className={styles.categoryIcon}><Icon name="sparkle" size={27} /><small>Nuevo</small></div>
            <div className={styles.cardCopy}><h3>Tratamientos</h3><p>Alternativas ópticas disponibles</p></div>
          </Link>
          <Link className={`${styles.bentoCard} ${styles.accessories}`} href="/tienda?category=ACCESSORY">
            <div className={styles.categoryIcon}><Icon name="package" size={27} /></div>
            <div className={styles.cardCopy}><h3>Accesorios</h3><p>Estuches y limpieza</p></div>
          </Link>
        </div>
      </section>

      <section className={styles.products} aria-labelledby="favorites-title">
        <div className={styles.centerHeading}><h2 id="favorites-title">Los favoritos de la semana</h2><p>Productos publicados en el catálogo real de Óptica Stylo.</p></div>
        <FeaturedProducts />
        <div className={styles.centerAction}><Link className={styles.outlineButton} href="/tienda">Ver todos los modelos</Link></div>
      </section>

      <section className={styles.tryOn}>
        <div className={styles.tryOnInner}>
          <div className={styles.tryOnCopy}>
            <span><Icon name="sparkle" size={14} /> Stylo Vivo</span>
            <h2>Pruébate los lentes<br />sin salir de casa.</h2>
            <p>Nuestra tecnología de prueba virtual te permite comparar los marcos 3D disponibles usando la cámara de tu dispositivo.</p>
            <ol>
              <li><b>1</b><div><strong>Elige tu marco favorito</strong><small>Navega por el catálogo y selecciona un modelo compatible.</small></div></li>
              <li><b>2</b><div><strong>Activa tu cámara</strong><small>Permite el acceso para iniciar la experiencia virtual.</small></div></li>
              <li><b>3</b><div><strong>Mira cómo te queda</strong><small>Compara el marco en tiempo real desde diferentes ángulos.</small></div></li>
            </ol>
            <Link className={styles.primaryButton} href="/virtual-try-on/3d"><Icon name="eye" size={18} /> Iniciar Prueba Virtual</Link>
          </div>
          <div className={styles.tryOnMedia}>
            <Image alt="Demostración del probador virtual Stylo Vivo" fill sizes="(max-width: 960px) 100vw, 50vw" src={stitchImages.tryOn} />
            <span><i /> Live 3D</span>
          </div>
        </div>
      </section>

      <section className={styles.services} id="stylo" aria-label="Servicios de Óptica Stylo">
        <article className={styles.evaluationCard}>
          <span className={styles.serviceIcon}><Icon name="calendar" size={25} /></span>
          <h3>Evaluación Oftalmológica</h3>
          <p>Agenda una hora disponible para tu evaluación visual directamente desde la web.</p>
          <Link href="/reservar">Reserva de hora <Icon name="calendar" size={15} /></Link>
        </article>
        <div className={styles.serviceStack}>
          <article><span className={styles.serviceIcon}><Icon name="file" size={21} /></span><div><h3>Recetas de cualquier centro</h3><p>No necesitas atenderte aquí para comprar. Puedes adjuntar o ingresar una receta externa.</p></div></article>
          <article><span className={styles.serviceIcon}><Icon name="cart" size={21} /></span><div><h3>Compra con cuenta o invitado</h3><p>Elige la modalidad que prefieras y continúa tu compra desde el carrito.</p></div></article>
        </div>
      </section>

      <section className={styles.experience}>
        <div className={styles.centerHeading}><h2>Todo pensado para una compra más simple</h2><p>Una experiencia conectada entre la reserva, la atención óptica y la tienda.</p></div>
        <div className={styles.experienceGrid}>{experienceCards.map((item) => <article key={item.title}><span><Icon name={item.icon} size={21} /></span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
      </section>
    </main>
    <PublicFooter />
  </>;
}
