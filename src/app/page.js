import Link from "next/link";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import FeaturedProducts from "@/components/store/featured-products";
import Icon from "@/components/ui/icon";
import mobileStyles from "./home-mobile.module.css";
import styles from "./page.module.css";

const categories = [
  { className: "frames", eyebrow: "Marcos", href: "/tienda?category=FRAME", title: "Encuentra tu forma" },
  { className: "lenses", eyebrow: "Cristales", href: "/tienda?category=PRESCRIPTION_LENS", title: "Visión a tu medida" },
  { className: "accessories", eyebrow: "Accesorios", href: "/tienda?category=ACCESSORY", title: "Los detalles cuentan" },
];

const services = [
  { description: "Elige una hora disponible desde la web y recibe la confirmación de tu reserva.", icon: "calendar", title: "Reserva en línea" },
  { description: "Puedes comprar con una receta emitida aquí o en cualquier otro centro.", icon: "file", title: "Recetas externas" },
  { description: "La compra puede hacerse con cuenta o como invitado, según prefieras.", icon: "cart", title: "Compra a tu manera" },
];

export default function HomePage() {
  return <>
    <PublicHeader />
    <main>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className="eyebrow">Óptica Stylo · Stylo Vivo</p>
          <h1>Tu mirada.<br /><span>Tu manera.</span></h1>
          <p className={styles.lead}>Descubre marcos que hablan de ti, pruébalos en 3D y completa tu compra con una experiencia clara y acompañada.</p>
          <div className={styles.heroActions}><Link className="button button--primary" href="/tienda">Ver marcos <Icon name="arrow" /></Link><Link className="button button--secondary" href="/virtual-try-on/3d"><Icon name="eye" /> Probarme lentes</Link></div>
          <div className={`${styles.heroFacts} ${mobileStyles.heroFacts}`}><span><Icon name="check" /> Compra segura</span><span><Icon name="check" /> Retiro en tienda</span><span><Icon name="check" /> Receta externa</span></div>
        </div>
        <div className={styles.heroVisual} aria-label="Experiencia visual de Óptica Stylo">
          <div className={styles.portrait} aria-hidden="true"><span className={styles.face}><i /><b /><i /></span></div>
          <div className={styles.floatingCard}><span><Icon name="eye" /></span><div><strong>Probador virtual 3D</strong><small>Visualiza marcos compatibles</small></div><Icon name="chevron" /></div>
          <div className={styles.liveBadge}><i /> Seguimiento en tu dispositivo</div>
        </div>
      </section>

      <section className={styles.categorySection} aria-labelledby="category-title">
        <div className={styles.splitHeading}><div><p className="eyebrow">Explora a tu manera</p><h2 id="category-title">Una colección para cada mirada</h2></div><Link href="/tienda">Ver todo el catálogo <Icon name="arrow" /></Link></div>
        <div className={styles.categoryGrid}>{categories.map((category) => <Link className={`${styles.categoryCard} ${styles[category.className]}`} href={category.href} key={category.title}><div className={styles.categoryArt} aria-hidden="true"><span /><i /><span /></div><div><p>{category.eyebrow}</p><h3>{category.title}</h3><span>Explorar <Icon name="arrow" size={17} /></span></div></Link>)}</div>
      </section>

      <section className={styles.products} aria-labelledby="favorites-title"><div className={styles.splitHeading}><div><p className="eyebrow">Selección publicada</p><h2 id="favorites-title">Favoritos para empezar</h2></div><Link href="/tienda">Ver todos <Icon name="arrow" /></Link></div><FeaturedProducts /></section>

      <section className={styles.tryOn}>
        <div className={styles.tryOnCopy}><p className="eyebrow eyebrow--light">Prueba virtual 3D</p><h2>Pruébatelos antes de elegir.</h2><p>Activa tu cámara y compara los modelos 3D que estén vinculados al catálogo. El procesamiento facial ocurre en tu dispositivo.</p><Link className="button button--light" href="/virtual-try-on/3d">Abrir probador <Icon name="arrow" /></Link></div>
        <div className={styles.tryOnVisual} aria-hidden="true"><div className={styles.scanLine} /><div className={styles.tryFace}><span /><i /><span /></div><p><i /> Cámara lista</p></div>
      </section>

      <section className={styles.serviceSection} id="stylo" aria-labelledby="service-title">
        <div className="section-heading"><p className="eyebrow">Te acompañamos</p><h2 id="service-title">Más simple, más cercano</h2><p>Una experiencia conectada entre la tienda, la reserva y la atención óptica.</p></div>
        <div className={styles.serviceGrid}>{services.map((service) => <article key={service.title}><span><Icon name={service.icon} /></span><h3>{service.title}</h3><p>{service.description}</p></article>)}</div>
        <div className={styles.bookingBanner}><div><p className="eyebrow eyebrow--light">Atención visual</p><h2>¿Necesitas una evaluación?</h2><p>Revisa las horas disponibles y reserva directamente desde la web.</p></div><Link className="button button--light" href="/reservar">Reservar una hora <Icon name="arrow" /></Link></div>
      </section>
    </main>
    <PublicFooter />
  </>;
}
