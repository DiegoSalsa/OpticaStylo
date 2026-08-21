import Link from "next/link";
import BrandLogo from "@/components/brand/brand-logo";

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer__inner">
        <div className="public-footer__brand"><BrandLogo compact /><p>Mira el mundo con tu mejor estilo. Una experiencia cercana para elegir, reservar y cuidar tu visión.</p></div>
        <div><h2>Explora</h2><Link href="/tienda">Tienda</Link><Link href="/virtual-try-on/3d">Prueba Virtual</Link><Link href="/reservar">Reserva Evaluación</Link></div>
        <div><h2>Enlaces Legales</h2><Link href="/terminos">Términos y Condiciones</Link><Link href="/privacidad">Políticas de Privacidad</Link></div>
        <div><h2>Ayuda</h2><Link href="/contacto">Contacto</Link><Link href="/cuenta">Mi cuenta</Link><Link href="/carrito">Mi carrito</Link></div>
      </div>
      <p className="public-footer__legal">© {new Date().getFullYear()} Óptica Stylo · Concepción, Chile.</p>
    </footer>
  );
}
