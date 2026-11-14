import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";
import PasswordRecovery from "./password-recovery";
import "../account.css";

export const metadata = { title: "Recuperar contraseña | Óptica Stylo" };

export default function PasswordRecoveryPage() {
  return <><PublicHeader /><PasswordRecovery /><PublicFooter /></>;
}
