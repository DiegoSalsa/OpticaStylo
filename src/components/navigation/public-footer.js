import Link from "next/link";
import BrandLogo from "@/components/brand/brand-logo";

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer__inner">
        <div className="public-footer__brand"><BrandLogo compact /><p>Una experiencia cercana para elegir, reservar y cuidar tu visión.</p></div>
        <div><h2>Explora</h2><Link href="/tienda">Tienda</Link><Link href="/virtual-try-on/3d">Prueba virtual 3D</Link><Link href="/reservar">Reserva una hora</Link></div>
        <div><h2>Tu cuenta</h2><Link href="/cuenta">Ingresar o crear cuenta</Link><Link href="/cuenta">Mis pedidos</Link><Link href="/carrito">Mi carrito y recetas</Link></div>
        <div><h2>Información</h2><Link href="/privacidad">Privacidad</Link><Link href="/terminos">Términos y condiciones</Link><Link href="/contacto">Contacto</Link></div>
      </div>
      <p className="public-footer__legal">© {new Date().getFullYear()} Óptica Stylo. Todos los derechos reservados.</p>
    </footer>
  );
}
