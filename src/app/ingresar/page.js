import { Suspense } from "react";

import LoginExperience from "./login-experience";
import "./login.css";

export const metadata = { title: "Ingreso interno | Óptica Stylo" };

export default function LoginPage() {
  return <Suspense fallback={<main className="login-page"><section className="login-panel">Preparando acceso seguro…</section></main>}><LoginExperience /></Suspense>;
}
