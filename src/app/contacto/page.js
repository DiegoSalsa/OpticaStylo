import Link from "next/link";
import InformationPage from "@/components/content/information-page";

export const metadata = { title: "Contacto | Óptica Stylo" };
export default function ContactPage(){return <InformationPage eyebrow="Hablemos" title="Contacto" intro="Aún no se han confirmado canales, horarios ni direcciones públicas; no publicaremos datos inventados."><section><h2>¿Quieres reservar?</h2><p>La reserva en línea ya está preparada para mostrar únicamente profesionales y horarios reales configurados.</p><Link className="button button--primary" href="/reservar">Reservar una hora</Link></section><section><h2>¿Tienes una consulta sobre tu compra?</h2><p>Los canales oficiales aparecerán aquí cuando la clienta confirme correo, teléfono, WhatsApp, horarios y las tres sucursales.</p></section></InformationPage>}
