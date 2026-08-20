import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import BookingExperience from "./booking-experience";
import styles from "./booking.module.css";

export const metadata = { description: "Revisa horas disponibles y reserva una evaluación en Óptica Stylo.", title: "Reservar evaluación" };

export default function BookingPage() {
  return <><PublicHeader /><main className={styles.page}><header className={styles.heading}><p className="eyebrow">Reserva en línea</p><h1>Tu próxima evaluación, en pocos pasos</h1><p>Elige un profesional y una hora disponible. Luego completa los datos de la persona que será atendida.</p></header><BookingExperience /></main><PublicFooter /></>;
}
