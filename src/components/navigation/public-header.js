import Link from "next/link";
import BrandLogo from "@/components/brand/brand-logo";
import Icon from "@/components/ui/icon";

const navigation = [
  { href: "/", label: "Inicio" },
  { href: "/tienda", label: "Tienda" },
  { href: "/virtual-try-on/3d", label: "Prueba Virtual" },
  { href: "/reservar", label: "Reserva Evaluación" },
  { href: "/#stylo", label: "Nosotros" },
];

export default function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-header__inner">
        <Link aria-label="Ir al inicio de Óptica Stylo" className="public-header__brand" href="/"><BrandLogo compact priority /></Link>
        <nav aria-label="Navegación principal" className="public-header__navigation">
          {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="public-header__actions">
          <form action="/tienda" className="public-header__search"><Icon name="search" size={15} /><input aria-label="Buscar productos" name="search" placeholder="Buscar marcos, lentes..." type="search" /></form>
          <Link aria-label="Carrito" className="icon-button" href="/carrito"><Icon name="cart" /></Link>
          <Link aria-label="Mi cuenta" className="icon-button" href="/cuenta"><Icon name="account" /></Link>
          <details className="mobile-menu">
            <summary aria-label="Abrir menú"><Icon name="menu" /></summary>
            <nav aria-label="Navegación móvil">
              {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
              <Link href="/cuenta">Mi cuenta</Link><Link href="/carrito">Carrito</Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
