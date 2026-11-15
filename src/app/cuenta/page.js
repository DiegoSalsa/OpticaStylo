import { Suspense } from "react";
import PublicFooter from "@/components/navigation/public-footer";
import PublicHeader from "@/components/navigation/public-header";

import AccountExperience from "./account-experience";
import "@/app/carrito/cart.css";
import "@/app/carrito/checkout-stitch.css";
import "./account.css";

export const metadata = { title: "Mi cuenta | Óptica Stylo" };

export default function AccountPage() { return <><PublicHeader /><Suspense fallback={<main className="account-page"><p role="status">Cargando tu cuenta…</p></main>}><AccountExperience /></Suspense><PublicFooter /></>; }
