import Link from "next/link";
import InformationPage from "@/components/content/information-page";

export const metadata = { title: "Contacto | Óptica Stylo" };
// Mostrar los canales disponibles sin convertir decisiones comerciales pendientes en contenido público.
export default function ContactPage() {
  return <InformationPage eyebrow="Hablemos" title="Contacto" intro="Reserva una hora o consulta el estado de tus compras desde nuestra plataforma.">
    <section><h2>Reserva tu evaluación</h2><p>Consulta los profesionales y horarios disponibles en la agenda en línea.</p><Link className="button button--primary" href="/reservar">Reservar una hora</Link></section>
    <section><h2>Consulta tu pedido</h2><p>Si compraste con una cuenta, encontrarás tus pedidos al ingresar. Si compraste como invitado, utiliza el enlace de tu pedido en el mismo navegador de la compra.</p><Link className="button button--secondary" href="/cuenta">Mi cuenta</Link><Link className="button button--secondary" href="/carrito">Ver compra actual</Link></section>
  </InformationPage>;
}
